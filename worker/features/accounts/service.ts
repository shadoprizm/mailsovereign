import { newId, nowIso } from "../../db/client";
import type { WorkerEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";

export async function deletePersonalAccount(
  env: WorkerEnv,
  input: { userId: string; role: string; correlationId: string }
): Promise<void> {
  if (input.role === "owner") {
    throw new AppError(
      "OWNER_ACCOUNT_REQUIRED",
      "Transfer ownership or remove the workspace before deleting the owner account.",
      409
    );
  }

  const steward = await env.DB.prepare(
    `SELECT id FROM "user"
     WHERE role = 'owner' AND COALESCE(banned, 0) = 0 AND id <> ?
     ORDER BY createdAt LIMIT 1`
  )
    .bind(input.userId)
    .first<{ id: string }>();
  if (!steward) {
    throw new AppError("OWNER_ACCOUNT_REQUIRED", "An active workspace owner is required.", 409);
  }

  const attachmentRows = await env.DB.prepare(
    `SELECT attachment.r2_key FROM draft_attachments attachment
     JOIN drafts draft ON draft.id = attachment.draft_id
     WHERE draft.user_id = ?`
  )
    .bind(input.userId)
    .all<{ r2_key: string }>();
  await deleteObjects(
    env.MAIL_OBJECTS,
    attachmentRows.results.map((row) => row.r2_key)
  );

  const deletedEmail = `deleted+${crypto.randomUUID()}@invalid.example`;
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE audit_events SET actor_id = NULL WHERE actor_id = ?").bind(input.userId),
    env.DB.prepare("UPDATE mailbox_grants SET created_by = ? WHERE created_by = ?").bind(
      steward.id,
      input.userId
    ),
    env.DB.prepare("UPDATE retention_policies SET updated_by = ? WHERE updated_by = ?").bind(
      steward.id,
      input.userId
    ),
    env.DB.prepare("UPDATE user_onboarding SET created_by = NULL WHERE created_by = ?").bind(
      input.userId
    ),
    env.DB.prepare("DELETE FROM mailbox_grants WHERE user_id = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM verification WHERE value = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM oauthAccessToken WHERE userId = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM oauthRefreshToken WHERE userId = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM oauthConsent WHERE userId = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM oauthClient WHERE userId = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM message_sender_preferences WHERE user_id = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM user_mail_preferences WHERE user_id = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM ai_writing_profiles WHERE user_id = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM email_signature_defaults WHERE user_id = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM drafts WHERE user_id = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM email_signatures WHERE user_id = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM user_onboarding WHERE user_id = ?").bind(input.userId),
    env.DB.prepare("DELETE FROM account WHERE userId = ?").bind(input.userId),
    env.DB.prepare('DELETE FROM "session" WHERE userId = ?').bind(input.userId),
    env.DB.prepare(
      `UPDATE "user" SET name = 'Deleted user', email = ?, emailVerified = 0, image = NULL,
         role = 'member', banned = 1, banReason = 'account_deleted', banExpires = NULL,
         updatedAt = ? WHERE id = ?`
    ).bind(deletedEmail, timestamp, input.userId),
    env.DB.prepare(
      `INSERT INTO audit_events
         (id, occurred_at, correlation_id, actor_type, actor_id, action, resource_type,
          resource_id, outcome, metadata_json)
         VALUES (?, ?, ?, 'user', NULL, 'account.delete', 'user', ?, 'success', '{}')`
    ).bind(newId("aud"), timestamp, input.correlationId, input.userId)
  ]);
}

async function deleteObjects(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let index = 0; index < keys.length; index += 1000) {
    await bucket.delete(keys.slice(index, index + 1000));
  }
}
