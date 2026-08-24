import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  normalizeServerUrl,
  readDesktopConfig,
  writeDesktopConfig
} from "../../../desktop/config.mjs";
import { classifyNavigation, mayGrantPermission } from "../../../desktop/navigation.mjs";

describe("Ubuntu desktop configuration", () => {
  it("ships the desktop and server release under one version", () => {
    const rootPackage = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const desktopPackage = JSON.parse(
      readFileSync(join(process.cwd(), "desktop/package.json"), "utf8")
    );
    expect(desktopPackage.version).toBe(rootPackage.version);
  });

  it("normalizes a deployment address to its HTTPS origin", () => {
    expect(normalizeServerUrl("  https://mail.example.com/inbox?filter=unread  ")).toBe(
      "https://mail.example.com"
    );
    expect(normalizeServerUrl("https://mail.example.com:8443")).toBe(
      "https://mail.example.com:8443"
    );
  });

  it("rejects insecure, credentialed, and invalid addresses", () => {
    expect(() => normalizeServerUrl("http://mail.example.com")).toThrow("must use HTTPS");
    expect(() => normalizeServerUrl("https://owner:secret@mail.example.com")).toThrow(
      "must not contain"
    );
    expect(() => normalizeServerUrl("not a URL")).toThrow("valid HTTPS address");
  });

  it("writes a private local configuration and reads it back", () => {
    const workspace = mkdtempSync(join(tmpdir(), "sovereign-mail-desktop-"));
    const configFile = join(workspace, "profile", "desktop.json");

    writeDesktopConfig(configFile, "https://mail.example.com/inbox");

    expect(readDesktopConfig(configFile)).toEqual({ serverUrl: "https://mail.example.com" });
    expect(JSON.parse(readFileSync(configFile, "utf8"))).toEqual({
      serverUrl: "https://mail.example.com"
    });
    if (process.platform !== "win32") expect(statSync(configFile).mode & 0o777).toBe(0o600);
  });

  it("treats malformed saved configuration as unconfigured", () => {
    const workspace = mkdtempSync(join(tmpdir(), "sovereign-mail-desktop-invalid-"));
    expect(readDesktopConfig(join(workspace, "missing.json"))).toBeNull();
  });
});

describe("Ubuntu desktop navigation boundary", () => {
  const serverUrl = "https://mail.example.com";

  it("keeps application and Cloudflare authorization pages inside the client", () => {
    expect(classifyNavigation("https://mail.example.com/inbox", serverUrl)).toBe("application");
    expect(classifyNavigation("https://dash.cloudflare.com/oauth2/auth", serverUrl)).toBe(
      "authorization"
    );
  });

  it("opens safe unrelated links externally and blocks unsafe protocols", () => {
    expect(classifyNavigation("https://example.net/help", serverUrl)).toBe("external");
    expect(classifyNavigation("mailto:support@example.net", serverUrl)).toBe("external");
    expect(classifyNavigation("file:///etc/passwd", serverUrl)).toBe("blocked");
    expect(classifyNavigation("javascript:alert(1)", serverUrl)).toBe("blocked");
  });

  it("grants only notification permission to the configured deployment", () => {
    expect(mayGrantPermission("notifications", serverUrl, serverUrl)).toBe(true);
    expect(mayGrantPermission("media", serverUrl, serverUrl)).toBe(false);
    expect(mayGrantPermission("notifications", "https://example.net", serverUrl)).toBe(false);
  });
});
