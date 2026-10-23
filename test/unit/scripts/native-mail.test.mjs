import { describe, expect, it } from "vitest";
import { createWranglerConfig } from "../../../scripts/sovereign-mail/config.mjs";
import { createManifest } from "../../../scripts/sovereign-mail/install.mjs";
import { nativeMailConfig } from "../../../scripts/sovereign-mail/native-mail.mjs";

const options = { authUrl: "https://mail.example.com", oauthClientId: "customer-client" };
describe("manifest-backed native mail configuration", () => {
  it("keeps existing installations disabled until an operator configures a gateway", () => {
    expect(
      createWranglerConfig(createManifest("test", options)).vars.SOVEREIGN_MAIL_NATIVE_MAIL_HOST
    ).toBeUndefined();
  });
  it("records a normalized hostname and emits the same setting for the Worker", () => {
    const manifest = createManifest("test", { ...options, nativeMailHost: "IMAP.Example.com" });
    expect(manifest.nativeMail).toEqual({ host: "imap.example.com", imapPort: 993, smtpPort: 465 });
    expect(createWranglerConfig(manifest).vars.SOVEREIGN_MAIL_NATIVE_MAIL_HOST).toBe(
      "imap.example.com"
    );
  });
  it.each([
    "https://imap.example.com",
    "imap.example.com:993",
    "imap.example.com/path",
    "localhost",
    "-bad.example",
    "bad..example",
    `${"a".repeat(64)}.example`
  ])("rejects invalid listener names: %s", (host) => {
    expect(() => nativeMailConfig(host)).toThrow("DNS hostname");
  });
  it("preserves separate public TCP endpoints in generated installation configuration", () => {
    const manifest = createManifest("test", options);
    manifest.nativeMail = nativeMailConfig("imap.mail.example.com", {
      smtpHost: "smtp.mail.example.com",
      imapPort: "24123",
      smtpPort: "32123"
    });
    const vars = createWranglerConfig(manifest).vars;
    expect(vars.SOVEREIGN_MAIL_NATIVE_MAIL_HOST).toBe("imap.mail.example.com");
    expect(vars.SOVEREIGN_MAIL_NATIVE_SMTP_HOST).toBe("smtp.mail.example.com");
    expect(vars.SOVEREIGN_MAIL_NATIVE_IMAP_PORT).toBe("24123");
    expect(vars.SOVEREIGN_MAIL_NATIVE_SMTP_PORT).toBe("32123");
    for (const imapPort of ["", "0", "65536", "993.5", "abc"])
      expect(() => nativeMailConfig("imap.example.com", { imapPort })).toThrow("ports");
  });
});
