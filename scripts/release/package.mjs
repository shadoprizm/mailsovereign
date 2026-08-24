#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "../..");
const product = "sovereign-mail";
const schemaVersion = 20;
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = process.env.SOVEREIGN_MAIL_RELEASE_VERSION ?? packageJson.version;
const minVersion =
  process.env.SOVEREIGN_MAIL_MIN_VERSION || packageJson.sovereignMailRelease?.minimumVersion;
const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const privateKeyValue = process.env.SOVEREIGN_MAIL_RELEASE_PRIVATE_KEY_FILE
  ? readFileSync(process.env.SOVEREIGN_MAIL_RELEASE_PRIVATE_KEY_FILE, "utf8")
  : process.env.SOVEREIGN_MAIL_RELEASE_PRIVATE_KEY;

if (!privateKeyValue) throw new Error("SOVEREIGN_MAIL_RELEASE_PRIVATE_KEY is required.");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error("Release version must be semantic.");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(minVersion ?? ""))
  throw new Error("Minimum release version must be semantic.");
if (!changelog.includes(`## ${version}\n`))
  throw new Error(`CHANGELOG.md is missing release notes for ${version}.`);

const output = resolve(root, "release");
mkdirSync(output, { recursive: true });
const desktopArtifactFiles = [
  {
    arch: "x86_64",
    filename: `sovereign-mail-desktop-${version}-ubuntu-amd64.deb`,
    format: "deb"
  },
  {
    arch: "x86_64",
    filename: `sovereign-mail-desktop-${version}-ubuntu-x86_64.AppImage`,
    format: "appimage"
  }
];
const desktopArtifacts = desktopArtifactFiles
  .filter(({ filename }) => existsSync(resolve(output, filename)))
  .map(({ arch, filename, format }) => {
    const file = resolve(output, filename);
    const artifactBytes = readFileSync(file);
    return {
      platform: "linux",
      distribution: "ubuntu",
      arch,
      format,
      filename,
      url: `https://github.com/shadoprizm/mailsovereign/releases/download/v${version}/${filename}`,
      sha256: createHash("sha256").update(artifactBytes).digest("hex"),
      size: statSync(file).size
    };
  });
if (
  process.env.SOVEREIGN_MAIL_REQUIRE_UBUNTU_DESKTOP === "1" &&
  desktopArtifacts.length !== desktopArtifactFiles.length
) {
  throw new Error("Both Ubuntu desktop artifacts are required for a stable release.");
}
const tarFile = resolve(output, `${product}-${version}.tar`);
const artifactFile = `${tarFile}.gz`;
execFileSync("git", ["archive", "--format=tar", "--output", tarFile, "HEAD"], { cwd: root });
writeFileSync(artifactFile, gzipSync(readFileSync(tarFile), { level: 9 }));
rmSync(tarFile);

const bytes = readFileSync(artifactFile);
const manifest = {
  format: "sovereign-mail-release-v1",
  product,
  channel: "stable",
  version,
  schemaVersion,
  minVersion,
  publishedAt: new Date().toISOString(),
  notesUrl: `https://github.com/shadoprizm/mailsovereign/releases/tag/v${version}`,
  artifact: {
    url: `https://github.com/shadoprizm/mailsovereign/releases/download/v${version}/sovereign-mail-${version}.tar.gz`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: statSync(artifactFile).size
  },
  ...(desktopArtifacts.length > 0 ? { desktopArtifacts } : {}),
  keyId: "sovereign-mail-release-2026-01"
};
const payload = Buffer.from(JSON.stringify(manifest)).toString("base64url");
const signature = sign(
  null,
  Buffer.from(payload, "base64url"),
  createPrivateKey(privateKeyValue)
).toString("base64url");
const envelope = `${JSON.stringify({ payload, signature })}\n`;
writeFileSync(resolve(output, `manifest-${version}.json`), envelope);
writeFileSync(resolve(output, "stable.json"), envelope);
writeFileSync(
  resolve(output, `sovereign-mail-${version}.sha256`),
  `${manifest.artifact.sha256}  sovereign-mail-${version}.tar.gz\n`
);
if (desktopArtifacts.length > 0) {
  writeFileSync(
    resolve(output, `sovereign-mail-desktop-${version}-ubuntu.sha256`),
    `${desktopArtifacts.map(({ filename, sha256 }) => `${sha256}  ${filename}`).join("\n")}\n`
  );
}

console.log(
  JSON.stringify({
    product,
    version,
    artifactFile,
    desktopArtifacts: desktopArtifacts.map(({ filename }) => resolve(output, filename)),
    manifestFile: resolve(output, `manifest-${version}.json`),
    stableManifestFile: resolve(output, "stable.json")
  })
);
