import { accessibleMailboxIds } from "../../auth/mailbox-access";
import type { AuthContext } from "../../auth/session";
import { newId, nowIso } from "../../db/client";
import type { WorkerEnv } from "../../lib/env";
import { AppError, toAppError } from "../../lib/errors";
import type { WorkspaceRole } from "../../lib/validation";
import { assertOrganizationAiAvailable, runOrganizationAiBatch } from "../ai/organization-service";
import type { AiModelId } from "../billing/types";
import { applyBulkRun, undoBulkRun } from "./bulk-assignments";
import {
  createBulkOrganizationRun,
  currentBulkOrganizationRun,
  finishBulkRunIfComplete,
  markBulkRunRunning,
  nextBulkTargets,
  pauseBulkRun,
  readBulkRunForProcessing,
  requireBulkOrganizationRun,
  resumeBulkRun,
  storeBulkBatch
} from "./bulk-repository";
import { type BulkOrganizationScope, bulkOrganizationAvailability } from "./bulk-scope";
import { listMailLabels } from "./repository";
import type { BulkOrganizationRun } from "./types";

const organizationBatchSize = 10;

export async function startBulkOrganization(
  env: WorkerEnv,
  input: { auth: AuthContext; model: AiModelId; scope?: BulkOrganizationScope }
): Promise<BulkOrganizationRun> {
  if (!env.SOVEREIGN_MAIL_JOBS) {
    throw new AppError(
      "ORGANIZATION_QUEUE_UNAVAILABLE",
      "Background organization is not configured.",
      503
    );
  }
  const mailboxIds = await accessibleMailboxIds(
    env.DB,
    input.auth.user.id,
    input.auth.user.role,
    "read"
  );
  const counts = await bulkOrganizationAvailability(env.DB, {
    userId: input.auth.user.id,
    mailboxIds
  });
  if ((input.scope === "all" ? counts.totalCount : counts.newCount) === 0) {
    throw new AppError(
      "ORGANIZATION_NO_NEW_MAIL",
      input.scope === "all"
        ? "There are no inbox conversations to organize."
        : "There is no new mail to organize.",
      409
    );
  }
  await assertOrganizationAiAvailable(env, input.model);
  await listMailLabels(env.DB, input.auth.user.id, mailboxIds);
  const run = await createBulkOrganizationRun(env.DB, {
    userId: input.auth.user.id,
    model: input.model,
    scope: input.scope ?? "new",
    mailboxIds
  });
  if (run.status !== "queued") return run;
  try {
    await enqueueBulkRun(env, run.id);
  } catch {
    await pauseBulkRun(env.DB, run.id, "ORGANIZATION_QUEUE_UNAVAILABLE");
  }
  return requireBulkOrganizationRun(env.DB, input.auth.user.id, run.id);
}

export async function readCurrentBulkOrganization(
  env: WorkerEnv,
  auth: AuthContext
): Promise<BulkOrganizationRun | null> {
  return currentBulkOrganizationRun(env.DB, auth.user.id);
}

export async function retryBulkOrganization(
  env: WorkerEnv,
  input: { auth: AuthContext; runId: string }
): Promise<BulkOrganizationRun> {
  if (!env.SOVEREIGN_MAIL_JOBS) {
    throw new AppError(
      "ORGANIZATION_QUEUE_UNAVAILABLE",
      "Background organization is not configured.",
      503
    );
  }
  const run = await requireBulkOrganizationRun(env.DB, input.auth.user.id, input.runId);
  await assertOrganizationAiAvailable(env, run.model);
  await resumeBulkRun(env.DB, input.auth.user.id, input.runId);
  try {
    await enqueueBulkRun(env, input.runId);
  } catch {
    await pauseBulkRun(env.DB, input.runId, "ORGANIZATION_QUEUE_UNAVAILABLE");
  }
  return requireBulkOrganizationRun(env.DB, input.auth.user.id, input.runId);
}

export async function applyBulkOrganization(
  env: WorkerEnv,
  input: { auth: AuthContext; runId: string }
): Promise<{ affected: number; run: BulkOrganizationRun }> {
  const mailboxIds = await accessibleMailboxIds(
    env.DB,
    input.auth.user.id,
    input.auth.user.role,
    "read"
  );
  const affected = await applyBulkRun(env.DB, {
    userId: input.auth.user.id,
    runId: input.runId,
    mailboxIds
  });
  return {
    affected,
    run: await requireBulkOrganizationRun(env.DB, input.auth.user.id, input.runId)
  };
}

export async function undoBulkOrganization(
  env: WorkerEnv,
  input: { auth: AuthContext; runId: string }
): Promise<{ affected: number; run: BulkOrganizationRun }> {
  const mailboxIds = await accessibleMailboxIds(
    env.DB,
    input.auth.user.id,
    input.auth.user.role,
    "read"
  );
  const affected = await undoBulkRun(env.DB, {
    userId: input.auth.user.id,
    runId: input.runId,
    mailboxIds
  });
  return {
    affected,
    run: await requireBulkOrganizationRun(env.DB, input.auth.user.id, input.runId)
  };
}

export async function processBulkOrganizationJob(
  env: WorkerEnv,
  runId: string
): Promise<Record<string, number>> {
  if (!env.SOVEREIGN_MAIL_JOBS) throw new Error("SOVEREIGN_MAIL_JOBS binding is required.");
  const run = await readBulkRunForProcessing(env.DB, runId);
  if (!run || !["queued", "running"].includes(run.status)) {
    return { skipped: 1 };
  }
  await markBulkRunRunning(env.DB, runId);
  const targets = await nextBulkTargets(env.DB, runId, organizationBatchSize);
  if (!targets.length) {
    await finishBulkRunIfComplete(env.DB, runId);
    return { completed: 1, processed: 0 };
  }
  const actor = await readOrganizationActor(env.DB, run.userId);
  try {
    const result = await runOrganizationAiBatch(env, {
      actor,
      messageIds: targets.map((target) => target.messageId),
      model: run.model
    });
    const completed = await storeBulkBatch(env.DB, {
      runId,
      targets,
      suggestions: result.suggestions,
      creditsCharged: result.creditsCharged
    });
    if (!completed) await enqueueBulkRun(env, runId);
    return {
      completed: completed ? 1 : 0,
      processed: targets.length,
      suggestions: result.suggestions.length
    };
  } catch (error) {
    const appError = toAppError(error);
    await pauseBulkRun(env.DB, runId, appError.code);
    return { paused: 1, processed: 0 };
  }
}

async function enqueueBulkRun(env: WorkerEnv, runId: string): Promise<void> {
  await env.SOVEREIGN_MAIL_JOBS?.send({
    id: newId("orgjob"),
    kind: "organization-bulk",
    runId,
    requestedAt: nowIso()
  });
}

async function readOrganizationActor(
  db: D1Database,
  userId: string
): Promise<{ id: string; role: WorkspaceRole }> {
  const row = await db
    .prepare('SELECT id, role FROM "user" WHERE id = ?')
    .bind(userId)
    .first<{ id: string; role: string | null }>();
  if (!row) throw new AppError("USER_NOT_FOUND", "Organization user no longer exists.", 404);
  const role: WorkspaceRole =
    row.role === "owner" || row.role === "admin" || row.role === "member" ? row.role : "member";
  return { id: row.id, role };
}
