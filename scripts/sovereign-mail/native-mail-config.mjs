export function nativeMailConfig(hostname, options = {}) {
  if (hostname === undefined) return undefined;
  const host = hostname.toLowerCase();
  if (
    host.length > 253 ||
    !host.includes(".") ||
    !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new Error(
      "Native mail requires a DNS hostname with a trusted certificate, without a scheme, port, or path."
    );
  }
  const smtpHost = options.smtpHost ? nativeMailConfig(options.smtpHost).host : host;
  const imapPort = listenerPort(options.imapPort, 993);
  const smtpPort = listenerPort(options.smtpPort, 465);
  return { host, ...(smtpHost !== host ? { smtpHost } : {}), imapPort, smtpPort };
}

function listenerPort(value, fallback) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Native mail listener ports must be integers between 1 and 65535.");
  return port;
}
