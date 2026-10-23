import { readFile } from "node:fs/promises";

export function gatewayConfig(env) {
  const protocol = env.SOVEREIGN_MAIL_PROTOCOL ?? "both";
  if (!["both", "imap", "smtp"].includes(protocol))
    throw new Error("Gateway protocol must be imap, smtp, or both.");
  return {
    protocol,
    host: env.SOVEREIGN_MAIL_BIND_ADDRESS ?? "127.0.0.1",
    imapPort: port(env.SOVEREIGN_MAIL_IMAP_PORT ?? 993),
    smtpPort: port(env.SOVEREIGN_MAIL_SMTP_PORT ?? 465),
    healthPort: env.PORT ? port(env.PORT) : undefined
  };
}

export async function gatewayTls(env) {
  if (env.SOVEREIGN_MAIL_TLS_CERT_PEM || env.SOVEREIGN_MAIL_TLS_KEY_PEM) {
    if (!env.SOVEREIGN_MAIL_TLS_CERT_PEM || !env.SOVEREIGN_MAIL_TLS_KEY_PEM)
      throw new Error("Both secret PEM certificate and private key are required.");
    return { cert: env.SOVEREIGN_MAIL_TLS_CERT_PEM, key: env.SOVEREIGN_MAIL_TLS_KEY_PEM };
  }
  if (!env.SOVEREIGN_MAIL_TLS_CERT || !env.SOVEREIGN_MAIL_TLS_KEY)
    throw new Error("TLS certificate and key file references are required.");
  return {
    cert: await readFile(env.SOVEREIGN_MAIL_TLS_CERT),
    key: await readFile(env.SOVEREIGN_MAIL_TLS_KEY)
  };
}

function port(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 65535)
    throw new Error("Invalid mail listener port.");
  return result;
}
