import { newId } from "../../db/client";
import type { WorkerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { ProviderError } from "../../providers/errors";
import { submitMessage } from "../send/service";
import { authenticateService, privateDigest, type ServicePrincipal } from "./auth";
import { requireSenderGrant } from "./mailboxes";
import type { TransactionalInput } from "./validation";

type SendRecord = {
  id: string;
  payload_hash: string;
  status: string;
  error_code: string | null;
  http_status: number;
  updated_at: string;
};
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
async function previous(
  db: D1Database,
  applicationId: string,
  keyHash: string
): Promise<SendRecord | null> {
  return db
    .prepare(
      "SELECT id, payload_hash, status, error_code, http_status, updated_at FROM transactional_sends WHERE application_id = ? AND key_hash = ?"
    )
    .bind(applicationId, keyHash)
    .first<SendRecord>();
}
function replay(row: SendRecord, payloadHash: string): { id: string; status: "accepted" } | null {
  if (row.payload_hash !== payloadHash)
    throw new AppError(
      "IDEMPOTENCY_CONFLICT",
      "This idempotency key has already been used with a different payload.",
      409
    );
  if (row.status === "accepted") return { id: row.id, status: "accepted" };
  if (row.status === "retryable") return null;
  if (row.status === "pending")
    throw new AppError(
      "SEND_IN_PROGRESS",
      "Submission is in progress or awaiting reconciliation. Retry only with the same key.",
      503
    );
  throw new AppError(
    row.error_code ?? "DELIVERY_UNCERTAIN",
    row.status === "uncertain"
      ? "Provider acceptance is uncertain. This key will not resend; an administrator must reconcile delivery."
      : "The provider rejected this submission.",
    row.http_status
  );
}
export async function sendTransactional(
  env: WorkerEnv,
  request: Request,
  principal: ServicePrincipal,
  input: TransactionalInput,
  key: string,
  submit = submitMessage
): Promise<{ id: string; status: "accepted" }> {
  const started = Date.now();
  const mailbox = await requireSenderGrant(
    env.DB,
    principal.application_id,
    principal.workspace_id,
    input.from.email
  );
  const [keyHash, payloadHash] = await Promise.all([
    privateDigest(principal.digest_key, `key:${key}`),
    privateDigest(principal.digest_key, `payload:${canonicalJson(input)}`)
  ]);
  const existing = await previous(env.DB, principal.application_id, keyHash);
  if (existing) {
    const result = replay(existing, payloadHash);
    if (result) return result;
    if (Date.now() - Date.parse(existing.updated_at) < 30_000)
      throw new AppError("PROVIDER_TEMPORARY", "Retry the same request after 30 seconds.", 503);
  }
  const id = existing?.id ?? newId("msg");
  const timestamp = new Date().toISOString();
  try {
    const claimed = existing
      ? await env.DB.prepare(`UPDATE transactional_sends SET status = 'pending', updated_at = ?, attempt_count = attempt_count + 1,
          credential_prefix = ?, error_code = NULL WHERE id = ? AND status = 'retryable' AND updated_at = ?`)
          .bind(timestamp, principal.prefix, id, existing.updated_at)
          .run()
      : await env.DB.prepare(`INSERT INTO transactional_sends (id, application_id, credential_prefix, address_id, mailbox_id, key_hash, payload_hash, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
          .bind(
            id,
            principal.application_id,
            principal.prefix,
            mailbox.id,
            mailbox.mailbox_id,
            keyHash,
            payloadHash,
            timestamp,
            timestamp
          )
          .run();
    if (!claimed.meta.changes)
      throw new AppError("SEND_IN_PROGRESS", "Another request is submitting this message.", 503);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const concurrent = await previous(env.DB, principal.application_id, keyHash);
    if (concurrent) {
      const result = replay(concurrent, payloadHash);
      if (result) return result;
    }
    if (error instanceof Error && error.message.includes("TRANSACTIONAL_QUOTA")) {
      const quota = await env.DB.prepare(
        "SELECT day_bucket, day_count, per_day FROM service_applications WHERE id = ?"
      )
        .bind(principal.application_id)
        .first<{ day_bucket: string; day_count: number; per_day: number }>();
      const seconds = Math.floor(Date.now() / 1000);
      const daily =
        quota?.day_bucket === new Date().toISOString().slice(0, 10) &&
        quota.day_count >= quota.per_day;
      throw new QuotaError(daily ? 86400 - (seconds % 86400) : 60 - (seconds % 60));
    }
    if (concurrent)
      throw new AppError("SEND_IN_PROGRESS", "Another request is submitting this message.", 503);
    throw new AppError(
      "SEND_UNAVAILABLE",
      "Could not reserve the submission. Retry with the same key.",
      503
    );
  }
  // Recheck current authorization after reservation, before crossing the provider boundary.
  try {
    await authenticateService(env, request);
    const currentSender = await requireSenderGrant(
      env.DB,
      principal.application_id,
      principal.workspace_id,
      input.from.email
    );
    if (currentSender.connection_id !== mailbox.connection_id)
      throw new AppError("MAILBOX_UNAVAILABLE", "The sender route changed before submission.", 422);
    await env.DB.batch([
      env.DB.prepare("UPDATE service_applications SET last_used_at = ? WHERE id = ?").bind(
        timestamp,
        principal.application_id
      ),
      env.DB.prepare("UPDATE service_credentials SET last_used_at = ? WHERE id = ?").bind(
        timestamp,
        principal.credential_id
      )
    ]);
  } catch (error) {
    await finish(
      env.DB,
      id,
      "failed",
      error instanceof AppError ? error.code : "SEND_UNAVAILABLE",
      error instanceof AppError ? error.status : 503,
      started
    );
    throw error;
  }
  try {
    await submit(
      env,
      {
        from: { email: input.from.email, name: input.from.name ?? "" },
        to: input.to.map((recipient) => recipient.email),
        cc: input.cc.map((recipient) => recipient.email),
        bcc: input.bcc.map((recipient) => recipient.email),
        recipientNames: Object.fromEntries(
          [...input.to, ...input.cc, ...input.bcc]
            .filter((recipient) => recipient.name)
            .map((recipient) => [recipient.email, recipient.name ?? ""])
        ),
        ...(input.replyTo
          ? { replyTo: { email: input.replyTo.email, name: input.replyTo.name ?? "" } }
          : {}),
        subject: input.subject,
        html: input.html,
        text: input.text,
        headers: Object.fromEntries(
          Object.entries(input.headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        ),
        messageId: `<${id}@${input.from.email.split("@")[1]}>`
      },
      { expectedConnectionId: mailbox.connection_id }
    );
  } catch (error) {
    const known = error instanceof ProviderError && error.definitelyNotAccepted;
    const retryable = known && error.retryable;
    const status = retryable ? "retryable" : known ? "failed" : "uncertain";
    const code = retryable
      ? "PROVIDER_TEMPORARY"
      : known
        ? "PROVIDER_REJECTED"
        : "DELIVERY_UNCERTAIN";
    const httpStatus = known && !retryable ? 422 : 503;
    await finish(env.DB, id, status, code, httpStatus, started);
    throw new AppError(
      code,
      retryable
        ? "The provider is temporarily unavailable. Retry with the same key."
        : known
          ? "The provider rejected this submission."
          : "Provider acceptance is uncertain. This key will not resend; an administrator must reconcile delivery.",
      httpStatus
    );
  }
  // Never turn persistence failure after provider acceptance into a retryable send.
  await finish(env.DB, id, "accepted", null, 200, started);
  return { id, status: "accepted" };
}
async function finish(
  db: D1Database,
  id: string,
  status: string,
  code: string | null,
  httpStatus: number,
  started: number
): Promise<void> {
  await db
    .prepare(
      "UPDATE transactional_sends SET status = ?, error_code = ?, http_status = ?, updated_at = ?, duration_ms = ? WHERE id = ? AND status = 'pending'"
    )
    .bind(status, code, httpStatus, new Date().toISOString(), Date.now() - started, id)
    .run();
}

export class QuotaError extends AppError {
  constructor(readonly retryAfter: number) {
    super(
      "QUOTA_EXCEEDED",
      "The application's per-minute or daily sending quota is exhausted.",
      429
    );
  }
}
