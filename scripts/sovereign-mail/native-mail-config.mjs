export function nativeMailConfig(hostname) {
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
  return { host, imapPort: 993, smtpPort: 465 };
}
