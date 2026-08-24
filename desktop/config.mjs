import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DESKTOP_CONFIG_FILENAME = "desktop.json";

export function normalizeServerUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Enter the HTTPS address of your Sovereign Mail deployment.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid HTTPS address, such as https://mail.example.com.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Sovereign Mail desktop connections must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("The server address must not contain a username or password.");
  }

  return url.origin;
}

export function readDesktopConfig(configFile) {
  try {
    const parsed = JSON.parse(readFileSync(configFile, "utf8"));
    return { serverUrl: normalizeServerUrl(parsed.serverUrl) };
  } catch {
    return null;
  }
}

export function writeDesktopConfig(configFile, serverUrl) {
  const config = { serverUrl: normalizeServerUrl(serverUrl) };
  mkdirSync(dirname(configFile), { recursive: true, mode: 0o700 });
  const temporaryFile = `${configFile}.${process.pid}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryFile, configFile);
  return config;
}
