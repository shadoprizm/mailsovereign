import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { MailApi } from "../src/api.mjs";
import { createImapServer } from "../src/imap.mjs";
import { createSmtpServer } from "../src/smtp.mjs";

let temporary, imap, smtp, connection;
const sockets = new Set();
const timeout = setTimeout(() => {
  console.error("Native staging verification timed out.");
  process.exit(1);
}, 70000);
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());
  const api = new MailApi(input.origin, (url, options) =>
    fetch(url, {
      ...options,
      headers: { ...options.headers, ...input.extraHeaders }
    })
  );
  const authenticated = await api.authenticate(input.address, input.password);
  const session = { nativeToken: authenticated.token };
  assert.equal((await api.folders(session)).length, 6);
  temporary = await mkdtemp(join(tmpdir(), "sovereign-staging-tls-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout",
      join(temporary, "key.pem"),
      "-out",
      join(temporary, "cert.pem")
    ],
    { stdio: "ignore" }
  );
  const cert = await readFile(join(temporary, "cert.pem"));
  const tls = { cert, key: await readFile(join(temporary, "key.pem")) };
  imap = createImapServer(api, tls, { pollIntervalMs: 250 });
  smtp = createSmtpServer(api, tls);
  for (const server of [imap.server, smtp.server])
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
  await Promise.all([
    new Promise((resolve) => imap.listen(0, "127.0.0.1", resolve)),
    new Promise((resolve) => smtp.listen(0, "127.0.0.1", resolve))
  ]);
  connection = new ImapFlow({
    host: "127.0.0.1",
    port: imap.server.address().port,
    secure: true,
    tls: { ca: cert },
    auth: { user: input.address, pass: input.password },
    logger: false,
    disableAutoIdle: true,
    socketTimeout: 15000
  });
  connection.on("error", () => {});
  await connection.connect();
  assert.equal((await connection.list()).length, 6);
  const raw = Buffer.from(
    `From: ${input.address}\r\nTo: synthetic@example.invalid\r\nSubject: Native staging fixture\r\nMessage-ID: <${crypto.randomUUID()}@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=fixture\r\n\r\n--fixture\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<b>Synthetic staging fixture</b>\r\n--fixture\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=fixture.txt\r\n\r\nSynthetic attachment\r\n--fixture--\r\n`
  );
  const appended = await connection.append("INBOX", raw, []);
  await connection.mailboxOpen("INBOX");
  const fetched = await connection.fetchOne(
    appended.uid,
    { source: true, bodyStructure: true, envelope: true },
    { uid: true }
  );
  assert.deepEqual(fetched.source, raw);
  assert.equal(fetched.bodyStructure.childNodes.length, 2);
  await connection.messageFlagsAdd(appended.uid, ["\\Seen", "\\Flagged"], { uid: true });
  const rows = await api.entries(session, "INBOX");
  const updated = rows.find((row) => row.uid === appended.uid);
  assert.ok(updated.flags.includes("\\Seen"));
  assert.ok(updated.flags.includes("\\Flagged"));
  await connection.messageCopy(appended.uid, "Drafts", { uid: true });
  await connection.messageMove(appended.uid, "Archive", { uid: true });
  await connection.mailboxOpen("Archive");
  assert.equal(connection.mailbox.exists, 1);
  const sent1 = await api.append(session, "Sent", ["\\Seen"], raw);
  const sent2 = await api.append(session, "Sent", ["\\Seen"], raw);
  assert.equal(sent1.id, sent2.id);
  assert.equal(sent1.uid, sent2.uid);
  await connection.mailboxOpen("INBOX");
  const arrived = new Promise((resolve) => connection.once("exists", resolve));
  const idling = connection.idle();
  await api.append(session, "INBOX", [], raw);
  await arrived;
  // A command ends IDLE before SMTP validation. No external message is submitted.
  await connection.noop();
  await idling;
  const transport = nodemailer.createTransport({
    host: "127.0.0.1",
    port: smtp.server.address().port,
    secure: true,
    tls: { ca: cert },
    auth: { user: input.address, pass: input.password },
    logger: false
  });
  await transport.verify();
  transport.close();
  const closed = new Promise((resolve) => connection.once("close", resolve));
  const idleUntilRevoked = connection.idle().catch(() => {});
  console.log(JSON.stringify({ phase: "revoke" }));
  await closed;
  await idleUntilRevoked;
  await assert.rejects(api.folders(session));
  console.log(JSON.stringify({ phase: "complete", checks: 12 }));
} catch {
  console.error("Native staging protocol verification failed.");
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  connection?.close();
  imap?.notifier.close();
  for (const socket of sockets) socket.destroy();
  await Promise.all([
    imap ? new Promise((resolve) => imap.close(resolve)) : null,
    smtp ? new Promise((resolve) => smtp.close(resolve)) : null
  ]);
  if (temporary) await rm(temporary, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
