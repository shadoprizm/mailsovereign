import { Hono } from "hono";
import { z } from "zod";

import { accessibleMailboxIds, requireMailboxAccess } from "../../auth/mailbox-access";
import { requireAuthContext } from "../../auth/session";
import type { HonoApp } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { parseWith } from "../../lib/validation";
import { recordAudit } from "../audit/service";

import type { MessageAction } from "./actions";
import { updateMatchingConversationReadState } from "./conversation-bulk-read";
import { listConversationPage, updateConversationAction } from "./conversation-queries";
import { deleteTrashedConversation } from "./deletion";
import { getMessageMailboxId } from "./queries";
import { conversationFolders } from "./types";

export const conversationRoutes = new Hono<HonoApp>();

const actions: readonly MessageAction[] = ["read", "unread", "star", "unstar", "archive", "trash"];
const folderSchema = z.enum(conversationFolders);
const cursorSchema = z.string().min(1).max(512).optional();
const labelIdSchema = z.string().min(1).max(100).optional();
const filterTextSchema = z.string().trim().min(1).max(500).optional();
const filterTimestampSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
  .optional();
const listQuerySchema = z.object({
  after: filterTimestampSchema,
  attachments: z.enum(["with", "without"]).optional(),
  before: filterTimestampSchema,
  contains: filterTextSchema,
  cursor: cursorSchema,
  direction: z.enum(["inbound", "outbound"]).optional(),
  exclude: filterTextSchema,
  folder: folderSchema.optional(),
  from: filterTextSchema,
  labelId: labelIdSchema,
  mailboxId: z.string().min(1).max(100).optional(),
  read: z.enum(["read", "unread"]).optional(),
  search: filterTextSchema,
  starred: z.enum(["starred", "unstarred"]).optional(),
  subject: filterTextSchema,
  to: filterTextSchema
});
const actionBodySchema = z.object({ folder: folderSchema });

conversationRoutes.get("/", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const mailboxIds = await accessibleMailboxIds(c.env.DB, auth.user.id, auth.user.role, "read");
  const query = parseWith(listQuerySchema, {
    after: c.req.query("after"),
    attachments: c.req.query("attachments"),
    before: c.req.query("before"),
    contains: c.req.query("contains"),
    cursor: c.req.query("cursor"),
    direction: c.req.query("direction"),
    exclude: c.req.query("exclude"),
    folder: c.req.query("folder"),
    from: c.req.query("from"),
    labelId: c.req.query("labelId"),
    mailboxId: c.req.query("mailboxId"),
    read: c.req.query("read"),
    search: c.req.query("search"),
    starred: c.req.query("starred"),
    subject: c.req.query("subject"),
    to: c.req.query("to")
  });
  if (query.after && query.before && query.after >= query.before) {
    throw new AppError(
      "INVALID_FILTER_DATE_RANGE",
      "The filter end date must be later than the start date.",
      400
    );
  }
  return c.json(
    await listConversationPage(c.env.DB, {
      ...query,
      labelUserId: auth.user.id,
      mailboxIds
    })
  );
});

conversationRoutes.post("/bulk-read-state", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const body = parseWith(
    z
      .object({
        action: z.enum(["read", "unread"]),
        filters: listQuerySchema.omit({ cursor: true }).extend({ folder: folderSchema }).strict()
      })
      .strict(),
    await c.req.json<unknown>().catch(() => ({}))
  );
  if (body.filters.after && body.filters.before && body.filters.after >= body.filters.before) {
    throw new AppError(
      "INVALID_FILTER_DATE_RANGE",
      "The filter end date must be later than the start date.",
      400
    );
  }
  const mailboxIds = await accessibleMailboxIds(c.env.DB, auth.user.id, auth.user.role, "read");
  const result = await updateMatchingConversationReadState(
    c.env.DB,
    {
      ...body.filters,
      mailboxIds,
      labelUserId: auth.user.id
    },
    body.action
  );
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: `conversation.bulk.${body.action}`,
    resourceType: "conversation",
    outcome: "success",
    metadata: result
  });
  return c.json(result);
});

conversationRoutes.delete("/:id", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  await requireMailboxAccess(
    c.env.DB,
    auth.user.id,
    auth.user.role,
    await getMessageMailboxId(c.env.DB, c.req.param("id")),
    "read"
  );
  const mailboxIds = await accessibleMailboxIds(c.env.DB, auth.user.id, auth.user.role, "agent");
  const deleted = await deleteTrashedConversation(c.env, {
    mailboxIds,
    messageId: c.req.param("id")
  });
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "conversation.delete",
    resourceType: "conversation",
    resourceId: deleted.threadId,
    outcome: "success",
    metadata: { affected: deleted.affected }
  });
  return c.json(deleted);
});

for (const action of actions) {
  conversationRoutes.post(`/:id/${action}`, async (c) => {
    const auth = await requireAuthContext(c.env, c.req.raw);
    const requiredAccess = action === "read" || action === "unread" ? "read" : "agent";
    await requireMailboxAccess(
      c.env.DB,
      auth.user.id,
      auth.user.role,
      await getMessageMailboxId(c.env.DB, c.req.param("id")),
      requiredAccess
    );
    const mailboxIds = await accessibleMailboxIds(
      c.env.DB,
      auth.user.id,
      auth.user.role,
      requiredAccess
    );
    const body = parseWith(actionBodySchema, await c.req.json<unknown>().catch(() => ({})));
    return c.json(
      await updateConversationAction(c.env.DB, {
        action,
        activeFolder: body.folder,
        mailboxIds,
        messageId: c.req.param("id")
      })
    );
  });
}
