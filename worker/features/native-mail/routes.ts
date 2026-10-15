import { Hono } from "hono";
import { z } from "zod";
import { requireAuthContext, requireRecentSessionForEnvironment } from "../../auth/session";
import type { HonoApp } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { readBoundedJson } from "../../lib/json";
import { parseWith } from "../../lib/validation";
import { recordAudit } from "../audit/service";
import { authenticateDevice, createDevicePassword, requireDeviceSession } from "./auth";
import {
  appendNativeMessage,
  expungeNativeMessage,
  moveNativeMessage,
  readRawBody,
  submitNativeMessage
} from "./messages";
import {
  entries,
  entry,
  entryFlags,
  folderData,
  journal,
  nativeFolders,
  setFlags
} from "./repository";

const pathSchema = z.enum(["INBOX", "Sent", "Drafts", "Archive", "Trash", "Catchall"]);
const flagsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_$\\-]+$/)
      .refine(
        (flag) =>
          !flag.startsWith("\\") ||
          ["\\Seen", "\\Flagged", "\\Answered", "\\Draft", "\\Deleted"].includes(flag)
      )
  )
  .max(64);
const uidSchema = z.number().int().min(1).max(4294967295);
const operationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("flags"),
    path: pathSchema,
    uid: uidSchema,
    action: z.enum(["set", "add", "remove"]),
    flags: flagsSchema,
    unchangedSince: z.number().int().nonnegative().optional()
  }),
  z.object({
    operation: z.literal("move"),
    path: pathSchema,
    uid: uidSchema,
    destination: pathSchema
  }),
  z.object({ operation: z.literal("expunge"), path: pathSchema, uid: uidSchema }),
  z.object({ operation: z.literal("subscribe"), path: pathSchema, subscribed: z.boolean() })
]);

export const nativeMailRoutes = new Hono<HonoApp>();

nativeMailRoutes.use("*", async (c, next) => {
  if (!c.env.SOVEREIGN_MAIL_NATIVE_MAIL_HOST) {
    if (c.req.method === "GET" && c.req.path.endsWith("/settings")) {
      return c.json({ enabled: false, host: null, imapPort: 993, smtpPort: 465, passwords: [] });
    }
    throw new AppError("NATIVE_MAIL_DISABLED", "Native mail gateway is not configured.", 503);
  }
  const origin = c.req.header("origin");
  if (c.req.method !== "GET" && origin && origin !== new URL(c.req.url).origin)
    throw new AppError("NATIVE_ORIGIN_FORBIDDEN", "Request origin is not allowed.", 403);
  await next();
});

nativeMailRoutes.get("/settings", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  const result = await c.env.DB.prepare(`SELECT p.id, p.mailbox_id AS mailboxId, p.label,
    p.created_at AS createdAt, p.revoked_at AS revokedAt, m.address
    FROM native_mail_passwords p JOIN mailboxes m ON m.id = p.mailbox_id WHERE p.user_id = ?
    ORDER BY p.created_at DESC`)
    .bind(auth.user.id)
    .all();
  return c.json({
    enabled: true,
    host: c.env.SOVEREIGN_MAIL_NATIVE_MAIL_HOST,
    imapPort: 993,
    smtpPort: 465,
    passwords: result.results
  });
});

nativeMailRoutes.post("/passwords", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRecentSessionForEnvironment(auth, c.env);
  const input = parseWith(
    z.object({ mailboxId: z.string().min(1).max(100), label: z.string().trim().min(1).max(80) }),
    await readBoundedJson(c.req.raw, 16384)
  );
  const result = await createDevicePassword(c.env.DB, auth, input.mailboxId, input.label);
  await recordAudit(c.env.DB, {
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action: "native-mail.password.create",
    resourceType: "mailbox",
    resourceId: input.mailboxId,
    outcome: "success"
  });
  return c.json(result, 201);
});

nativeMailRoutes.delete("/passwords/:id", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRecentSessionForEnvironment(auth, c.env);
  await c.env.DB.prepare(
    "UPDATE native_mail_passwords SET revoked_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(new Date().toISOString(), c.req.param("id"), auth.user.id)
    .run();
  return c.body(null, 204);
});

nativeMailRoutes.post("/authenticate", async (c) => {
  const input = parseWith(
    z.object({ address: z.string().email().max(254), password: z.string().min(1).max(128) }),
    await readBoundedJson(c.req.raw, 16384)
  );
  // The gateway may supply the original client address, but cannot bypass its own edge IP bucket.
  return c.json(
    await authenticateDevice(
      c.env,
      input.address.toLowerCase(),
      input.password,
      c.req.header("cf-connecting-ip") ?? "unknown"
    )
  );
});

nativeMailRoutes.get("/folders", async (c) => {
  const session = await requireDeviceSession(c.env.DB, c.req.header("authorization"));
  const subscribed = await c.env.DB.prepare(
    "SELECT folder_id, subscribed FROM native_mail_subscriptions WHERE password_id = ?"
  )
    .bind(session.passwordId)
    .all<{ folder_id: string; subscribed: number }>();
  const folders = await Promise.all(
    Object.keys(nativeFolders).map(async (path) => {
      const data = await folderData(c.env.DB, session, path);
      const counts = await c.env.DB.prepare(`SELECT COUNT(*) AS messages,
      COALESCE(SUM(m.read_at IS NULL), 0) AS unseen FROM native_mail_entries e
      JOIN messages m ON m.id = e.message_id WHERE e.folder_id = ?`)
        .bind(data._id)
        .first<{ messages: number; unseen: number }>();
      return {
        ...data,
        ...counts,
        subscribed: subscribed.results.find((row) => row.folder_id === data._id)?.subscribed !== 0
      };
    })
  );
  return c.json(folders);
});

nativeMailRoutes.get("/entries", async (c) => {
  const session = await requireDeviceSession(c.env.DB, c.req.header("authorization"));
  const path = parseWith(pathSchema, c.req.query("path"));
  const after = parseWith(
    z.coerce.number().int().nonnegative().max(4294967295),
    c.req.query("after") ?? 0
  );
  const rows = await entries(c.env.DB, session, path, after);
  return c.json(
    rows.map((row) => ({
      uid: row.uid,
      id: row.id,
      flags: entryFlags(row),
      modseq: row.modseq,
      idate: row.received_at ?? row.sent_at ?? row.created_at
    }))
  );
});

nativeMailRoutes.get("/journal", async (c) => {
  const session = await requireDeviceSession(c.env.DB, c.req.header("authorization"));
  const path = parseWith(pathSchema, c.req.query("path"));
  const after = parseWith(z.coerce.number().int().nonnegative(), c.req.query("after") ?? 0);
  return c.json(await journal(c.env.DB, session, path, after));
});

nativeMailRoutes.get("/raw/:uid", async (c) => {
  const session = await requireDeviceSession(c.env.DB, c.req.header("authorization"));
  const row = await entry(c.env.DB, session, parseWith(uidSchema, Number(c.req.param("uid"))));
  if (row.raw_r2_key) {
    const object = await c.env.MAIL_OBJECTS.get(row.raw_r2_key);
    if (!object) throw new AppError("NATIVE_SOURCE_MISSING", "Message source is unavailable.", 503);
    return new Response(object.body, {
      headers: { "content-type": "message/rfc822", "cache-control": "no-store" }
    });
  }
  const html = row.html_r2_key ? await c.env.MAIL_OBJECTS.get(row.html_r2_key) : null;
  const attachmentRows = await c.env.DB.prepare(
    "SELECT * FROM message_attachments WHERE message_id = ?"
  )
    .bind(row.id)
    .all<{
      filename: string;
      content_type: string;
      content_id: string | null;
      r2_key: string;
      size_bytes: number;
    }>();
  const attachments = [];
  let totalBytes = 0;
  for (const attachment of attachmentRows.results) {
    totalBytes += attachment.size_bytes;
    if (totalBytes > 25 * 1024 * 1024)
      throw new AppError("NATIVE_MESSAGE_TOO_LARGE", "Message exceeds 25 MiB.", 413);
    const object = await c.env.MAIL_OBJECTS.get(attachment.r2_key);
    if (!object) throw new AppError("NATIVE_SOURCE_MISSING", "Message source is unavailable.", 503);
    const bytes = new Uint8Array(await object.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    attachments.push({
      filename: attachment.filename,
      contentType: attachment.content_type,
      cid: attachment.content_id,
      content: btoa(binary),
      encoding: "base64"
    });
  }
  return c.json({
    from: row.from_address,
    to: JSON.parse(row.to_json),
    cc: JSON.parse(row.cc_json),
    bcc: JSON.parse(row.bcc_json),
    subject: row.subject,
    text: row.text_body,
    html: html ? await html.text() : undefined,
    messageId: row.message_id ?? `<${row.id}@sovereign-mail.invalid>`,
    inReplyTo: row.in_reply_to,
    references: JSON.parse(row.references_json),
    date: row.sent_at ?? row.received_at ?? row.created_at,
    attachments
  });
});

nativeMailRoutes.post("/append", async (c) => {
  const session = await requireDeviceSession(c.env.DB, c.req.header("authorization"));
  const meta = parseWith(
    z.object({
      path: pathSchema,
      flags: flagsSchema,
      date: z.string().datetime().optional(),
      forceCopy: z.boolean().optional()
    }),
    headerJson(c.req.header("x-native-message"))
  );
  return c.json(
    await appendNativeMessage(
      c.env,
      session,
      meta.path,
      await readRawBody(c.req.raw),
      meta.flags,
      meta.date,
      meta.forceCopy
    )
  );
});

nativeMailRoutes.post("/submit", async (c) => {
  const session = await requireDeviceSession(c.env.DB, c.req.header("authorization"));
  const meta = parseWith(
    z.object({
      from: z.string().email().max(254),
      recipients: z.array(z.string().email().max(254)).min(1).max(100)
    }),
    headerJson(c.req.header("x-native-envelope"))
  );
  return c.json(
    await submitNativeMessage(
      c.env,
      session,
      await readRawBody(c.req.raw),
      meta.from,
      meta.recipients
    )
  );
});

nativeMailRoutes.post("/operation", async (c) => {
  const session = await requireDeviceSession(c.env.DB, c.req.header("authorization"));
  const input = parseWith(operationSchema, await readBoundedJson(c.req.raw, 16384));
  switch (input.operation) {
    case "flags":
      return c.json(
        await setFlags(
          c.env.DB,
          session,
          input.path,
          input.uid,
          input.action,
          input.flags,
          input.unchangedSince
        )
      );
    case "move":
      return c.json(
        await moveNativeMessage(c.env, session, input.path, input.uid, input.destination)
      );
    case "expunge":
      return c.json(await expungeNativeMessage(c.env, session, input.path, input.uid));
    case "subscribe": {
      const folder = await folderData(c.env.DB, session, input.path);
      await c.env.DB.prepare(`INSERT INTO native_mail_subscriptions(password_id, folder_id, subscribed) VALUES (?, ?, ?)
        ON CONFLICT(password_id, folder_id) DO UPDATE SET subscribed = excluded.subscribed`)
        .bind(session.passwordId, folder._id, input.subscribed ? 1 : 0)
        .run();
      return c.json({ subscribed: input.subscribed });
    }
  }
});

function headerJson(value: string | undefined): unknown {
  if (!value || value.length > 32768)
    throw new AppError("INVALID_JSON", "Invalid message metadata.", 400);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AppError("INVALID_JSON", "Invalid message metadata.", 400);
  }
}
