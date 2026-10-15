import { optionalBoolean, requireString } from "./args.mjs";
import { writeWranglerConfig } from "./config.mjs";
import { loadManifest, writeManifest } from "./manifest.mjs";

export { nativeMailConfig } from "./native-mail-config.mjs";

import { nativeMailConfig } from "./native-mail-config.mjs";

export function configureNativeMail(flags) {
  const name = requireString(flags, "name");
  const manifest = loadManifest(name);
  if (optionalBoolean(flags, "disable")) delete manifest.nativeMail;
  else manifest.nativeMail = nativeMailConfig(requireString(flags, "host"));
  const dryRun = optionalBoolean(flags, "dry-run");
  writeManifest(manifest, { dryRun });
  writeWranglerConfig(manifest, { dryRun });
  console.log(
    dryRun
      ? "Native mail configuration validated; no files changed."
      : "Native mail configuration saved. Verify the gateway and deploy the selected Worker configuration to apply it."
  );
}
