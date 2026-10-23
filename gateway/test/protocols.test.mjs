import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { connect } from "node:tls";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { MailApi } from "../src/api.mjs";
import { createImapServer } from "../src/imap.mjs";
import { createSmtpServer } from "../src/smtp.mjs";
import { TestBackend } from "./backend.mjs";

let temporary, certificate, imap, smtp, imapPort, smtpPort;
const backend = new TestBackend();
const sockets = new Set();
const raw = Buffer.from(
  "From: owner@example.invalid\r\nTo: recipient@example.invalid\r\nSubject: Protocol fixture\r\nMessage-ID: <fixture@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=fixture\r\n\r\n--fixture\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<b>Fixture HTML</b>\r\n--fixture\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=fixture.txt\r\n\r\nFixture attachment\r\n--fixture--\r\n"
);

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "sovereign-native-tls-"));
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
  certificate = await readFile(join(temporary, "cert.pem"));
  const tls = { key: await readFile(join(temporary, "key.pem")), cert: certificate };
  imap = createImapServer(backend, tls, { pollIntervalMs: 50 });
  smtp = createSmtpServer(backend, tls);
  for (const server of [imap.server, smtp.server])
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
  await Promise.all([
    new Promise((resolve) => imap.listen(0, "127.0.0.1", resolve)),
    new Promise((resolve) => smtp.listen(0, "127.0.0.1", resolve))
  ]);
  imapPort = imap.server.address().port;
  smtpPort = smtp.server.address().port;
});
after(async () => {
  imap.notifier.close();
  for (const socket of sockets) socket.destroy();
  await Promise.all([
    new Promise((resolve) => imap.close(resolve)),
    new Promise((resolve) => smtp.close(resolve))
  ]);
  await rm(temporary, { recursive: true, force: true });
});
function client(password = "synthetic-password") {
  return new ImapFlow({
    host: "127.0.0.1",
    port: imapPort,
    secure: true,
    tls: { ca: certificate },
    auth: { user: "owner@example.invalid", pass: password },
    logger: false,
    disableAutoIdle: true,
    socketTimeout: 5000
  });
}

test("accepts trusted TLS connections using DNS server names", async () => {
  for (const port of [imapPort, smtpPort]) {
    await new Promise((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port, servername: "localhost", ca: certificate });
      socket.setTimeout(5000, () => socket.destroy(new Error("DNS TLS handshake timed out.")));
      socket.once("error", reject);
      socket.once("secureConnect", () => {
        socket.destroy();
        resolve();
      });
    });
  }
});

test("rejects a certificate that does not match the requested DNS hostname", async () => {
  await assert.rejects(
    new Promise((resolve, reject) => {
      const socket = connect({
        host: "127.0.0.1",
        port: imapPort,
        servername: "wrong.example",
        ca: certificate
      });
      socket.setTimeout(5000, () => socket.destroy(new Error("DNS TLS handshake timed out.")));
      socket.once("error", reject);
      socket.once("secureConnect", () => {
        socket.destroy();
        resolve();
      });
    }),
    { code: "ERR_TLS_CERT_ALTNAME_INVALID" }
  );
});
test("refuses insecure backends and redirects that would leak session tokens", async () => {
  assert.throws(() => new MailApi("http://example.invalid"));
  assert.throws(() => new MailApi("https://user:password@example.invalid"));
  let options;
  const api = new MailApi("https://example.invalid", async (_url, input) => {
    options = input;
    return new Response("[]");
  });
  await api.folders({ nativeToken: "synthetic" });
  assert.equal(options.redirect, "error");
});
test("TLS IMAP lists folders, appends MIME, fetches attachments, stores flags, copies, and moves", {
  timeout: 20000
}, async () => {
  const connection = client();
  await connection.connect();
  try {
    assert.equal((await connection.list()).length, 6);
    const appended = await connection.append("INBOX", raw, []);
    assert.ok(appended.uid);
    await connection.mailboxOpen("INBOX");
    const message = await connection.fetchOne(
      appended.uid,
      { source: true, envelope: true, bodyStructure: true, flags: true },
      { uid: true }
    );
    assert.equal(message.envelope.subject, "Protocol fixture");
    assert.deepEqual(message.source, raw);
    assert.equal(message.bodyStructure.childNodes.length, 2);
    await connection.messageFlagsAdd(appended.uid, ["\\Seen", "\\Flagged"], { uid: true });
    const flagged = await connection.fetchOne(appended.uid, { flags: true }, { uid: true });
    assert.ok(flagged.flags.has("\\Seen"));
    assert.ok(flagged.flags.has("\\Flagged"));
    const copied = await connection.messageCopy(appended.uid, "Sent", { uid: true });
    assert.ok(copied.uidMap.get(appended.uid) > appended.uid);
    const moved = await connection.messageMove(appended.uid, "Archive", { uid: true });
    assert.ok(moved.uidMap.get(appended.uid) > appended.uid);
    await connection.mailboxOpen("Archive");
    assert.equal(connection.mailbox.exists, 1);
    const matches = await connection.search({ subject: "Protocol" }, { uid: true });
    assert.equal(matches.length, 1);
  } finally {
    await connection.logout();
  }
});
test("TLS SMTP authenticates and rejects an unauthorized envelope sender", {
  timeout: 10000
}, async () => {
  const transport = nodemailer.createTransport({
    host: "127.0.0.1",
    port: smtpPort,
    secure: true,
    tls: { ca: certificate },
    auth: { user: "owner@example.invalid", pass: "synthetic-password" },
    logger: false
  });
  await transport.verify();
  await assert.rejects(
    transport.sendMail({
      raw,
      envelope: { from: "forged@example.invalid", to: ["recipient@example.invalid"] }
    })
  );
  assert.equal(backend.submissions, 0);
  await transport.sendMail({
    raw,
    envelope: { from: "owner@example.invalid", to: ["recipient@example.invalid"] }
  });
  assert.equal(backend.submissions, 1);
  transport.close();
});
test("rejects wrong IMAP passwords", { timeout: 10000 }, async () => {
  const connection = client("wrong");
  await assert.rejects(connection.connect());
  connection.close();
});
test("IDLE reports backend arrivals and closes a revoked session", { timeout: 10000 }, async () => {
  const connection = client();
  await connection.connect();
  await connection.mailboxOpen("INBOX");
  const count = connection.mailbox.exists;
  const exists = new Promise((resolve) => connection.once("exists", resolve));
  const idle = connection.idle();
  await backend.append(null, "INBOX", [], raw);
  const event = await exists;
  assert.equal(event.count, count + 1);
  const closed = new Promise((resolve) => connection.once("close", resolve));
  backend.revoked = true;
  await closed;
  await idle.catch(() => {});
});
