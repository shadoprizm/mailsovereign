import { createServer } from "node:http";
import { MailApi } from "./api.mjs";
import { gatewayConfig, gatewayTls } from "./config.mjs";
import { createImapServer } from "./imap.mjs";
import { createSmtpServer } from "./smtp.mjs";

const api = new MailApi(process.env.SOVEREIGN_MAIL_ORIGIN ?? "");
const config = gatewayConfig(process.env);
const tls = await gatewayTls(process.env);
const imap = config.protocol !== "smtp" ? createImapServer(api, tls) : null;
const smtp = config.protocol !== "imap" ? createSmtpServer(api, tls) : null;
const health = config.healthPort
  ? createServer((request, response) => {
      response.writeHead(request.url === "/health" ? 200 : 404, {
        "content-type": "application/json",
        "cache-control": "no-store"
      });
      response.end(request.url === "/health" ? '{"ok":true}' : '{"error":"not_found"}');
    })
  : null;
await Promise.all([
  ...(imap ? [listen(imap, config.imapPort, config.host)] : []),
  ...(smtp ? [listen(smtp, config.smtpPort, config.host)] : []),
  ...(health ? [listen(health, config.healthPort, config.host)] : [])
]);
console.log("Sovereign Mail encrypted gateway listeners are ready.");
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    imap?.notifier.close();
    imap?.close(() => {});
    smtp?.close(() => {});
    health?.close(() => {});
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
