import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  decodeDeploymentConfig,
  runWorkersBuildUpdate
} from "../../../scripts/release/workers-builds-update.mjs";

const config = {
  name: "sovereign-mail-production",
  vars: { SOVEREIGN_MAIL_WORKER_NAME: "sovereign-mail-production" },
  d1_databases: [{ binding: "DB", database_id: "database-id" }],
  r2_buckets: [{ binding: "MAIL_OBJECTS", bucket_name: "mail-bucket" }]
};

function encoded(value = config) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

describe("Workers Builds signed update runner", () => {
  it("accepts only a deployment-specific config with matching resources", () => {
    expect(decodeDeploymentConfig(encoded())).toEqual(config);
    expect(() =>
      decodeDeploymentConfig(
        encoded({
          ...config,
          vars: { ...config.vars, PROVIDER_CREDENTIAL_KEY: "must-not-be-here" }
        })
      )
    ).toThrow("must not be embedded");
    expect(() => decodeDeploymentConfig(encoded({ ...config, d1_databases: [] }))).toThrow(
      "D1 or R2"
    );
  });

  it("runs only in Workers Builds and removes the temporary config", async () => {
    let configFile = "";
    const deploy = vi.fn(async (options) => {
      configFile = options.configFile;
      expect(options.allowPublishedReleaseBehindCheckout).toBe(true);
      expect(JSON.parse(readFileSync(configFile, "utf8"))).toEqual(config);
    });
    await runWorkersBuildUpdate({
      deploy,
      environment: { WORKERS_CI: "1", SOVEREIGN_MAIL_DEPLOYMENT_CONFIG: encoded() }
    });
    expect(deploy).toHaveBeenCalledOnce();
    expect(existsSync(configFile)).toBe(false);

    await expect(
      runWorkersBuildUpdate({
        deploy,
        environment: { SOVEREIGN_MAIL_DEPLOYMENT_CONFIG: encoded() }
      })
    ).rejects.toThrow("only inside Cloudflare Workers Builds");
  });
});
