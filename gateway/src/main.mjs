import { readFile } from "node:fs/promises";
import { MailApi } from "./api.mjs";
import { createImapServer } from "./imap.mjs";
import { createSmtpServer } from "./smtp.mjs";

const api = new MailApi(process.env.SOVEREIGN_MAIL_ORIGIN ?? "");
const host = process.env.SOVEREIGN_MAIL_BIND_ADDRESS ?? "127.0.0.1";
const certFile = process.env.SOVEREIGN_MAIL_TLS_CERT;
const keyFile = process.env.SOVEREIGN_MAIL_TLS_KEY;
if (!certFile || !keyFile) throw new Error("TLS certificate and key file references are required.");
const tls = { cert: await readFile(certFile), key: await readFile(keyFile) };
const imap = createImapServer(api, tls);
const smtp = createSmtpServer(api, tls);
await Promise.all([
  listen(imap, Number(process.env.SOVEREIGN_MAIL_IMAP_PORT ?? 993), host),
  listen(smtp, Number(process.env.SOVEREIGN_MAIL_SMTP_PORT ?? 465), host)
]);
console.log("Sovereign Mail encrypted IMAP and SMTP listeners are ready.");
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    imap.notifier.close();
    imap.close(() => {});
    smtp.close(() => {});
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

function listen(server, port, host) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid mail listener port.");
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
}
