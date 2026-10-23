import { accessibleMailboxIds, requireMailboxAccess } from "../../auth/mailbox-access";
import type { AuthContext } from "../../auth/session";
import { AppError } from "../../lib/errors";
import { getMessageDetail } from "../messages/queries";
import {
  applyOrganizationRun,
  assignThreadLabels,
  readOrganizationRun,
  requireOwnedLabels,
  undoOrganizationRun
} from "./repository";

export async function updateConversationLabels(
  db: D1Database,
  input: {
    auth: AuthContext;
    messageIds: string[];
    labelIds: string[];
    operation: "add" | "remove";
  }
): Promise<{ affected: number }> {
  await requireOwnedLabels(db, input.auth.user.id, input.labelIds);
  const conversations = await requireAccessibleConversations(db, input.auth, input.messageIds);
  return {
    affected: await assignThreadLabels(db, {
      userId: input.auth.user.id,
      threadIds: conversations.map((item) => item.threadId),
      labelIds: input.labelIds,
      operation: input.operation
    })
  };
}

export async function applyOrganizationPreview(
  db: D1Database,
  input: {
    auth: AuthContext;
    runId: string;
    items: Array<{ messageId: string; labelId: string }>;
  }
): Promise<{ affected: number; runId: string }> {
  const run = await readOrganizationRun(db, input.auth.user.id, input.runId);
  if (run.status !== "preview") {
    throw new AppError(
      "ORGANIZATION_RUN_ALREADY_APPLIED",
      "This preview has already been used.",
      409
    );
  }
  const requested = new Map(
    input.items.map((item) => [`${item.messageId}:${item.labelId}`, item] as const)
  );
  if (requested.size !== input.items.length) {
    throw new AppError(
      "INVALID_ORGANIZATION_SELECTION",
      "Duplicate organization items are invalid.",
      400
    );
  }
  const selected = run.items.filter((item) => requested.has(`${item.messageId}:${item.labelId}`));
  if (selected.length !== requested.size) {
    throw new AppError(
      "INVALID_ORGANIZATION_SELECTION",
      "One or more suggestions are not part of this preview.",
      400
    );
  }
  await requireOwnedLabels(
    db,
    input.auth.user.id,
    selected.map((item) => item.labelId)
  );
  await requireAccessibleConversations(
    db,
    input.auth,
    selected.map((item) => item.messageId)
  );
  return {
    affected: await applyOrganizationRun(db, {
      userId: input.auth.user.id,
      runId: input.runId,
      items: selected.map((item) => ({ threadId: item.threadId, labelId: item.labelId }))
    }),
    runId: input.runId
  };
}

export async function undoAppliedOrganization(
  db: D1Database,
  input: { auth: AuthContext; runId: string }
): Promise<{ affected: number; runId: string }> {
  const run = await readOrganizationRun(db, input.auth.user.id, input.runId);
  if (run.status !== "applied") {
    throw new AppError(
      "ORGANIZATION_UNDO_UNAVAILABLE",
      "This organization run cannot be undone.",
      409
    );
  }
  if (run.items.length) {
    await requireAccessibleConversations(
      db,
      input.auth,
      run.items.map((item) => item.messageId)
    );
  }
  return {
    affected: await undoOrganizationRun(db, input.auth.user.id, input.runId),
    runId: input.runId
  };
}

export async function readableMailboxIds(db: D1Database, auth: AuthContext): Promise<string[]> {
  return accessibleMailboxIds(db, auth.user.id, auth.user.role, "read");
}

async function requireAccessibleConversations(
  db: D1Database,
  auth: AuthContext,
  messageIds: string[]
): Promise<Array<{ messageId: string; threadId: string }>> {
  const conversations = new Map<string, { messageId: string; threadId: string }>();
  for (const messageId of [...new Set(messageIds)]) {
    const message = await getMessageDetail(db, messageId);
    if (!message) throw new AppError("MESSAGE_NOT_FOUND", "Message not found.", 404);
    await requireMailboxAccess(db, auth.user.id, auth.user.role, message.mailboxId, "read");
    if (!conversations.has(message.threadId)) {
      conversations.set(message.threadId, { messageId: message.id, threadId: message.threadId });
    }
  }
  return [...conversations.values()];
}
