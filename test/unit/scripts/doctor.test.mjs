import { describe, expect, it } from "vitest";

import { assertRequiredWorkerSecrets } from "../../../scripts/sovereign-mail/doctor.mjs";

describe("Sovereign Mail deployment doctor", () => {
  it("accepts the complete core Worker secret set", () => {
    expect(() =>
      assertRequiredWorkerSecrets(
        JSON.stringify([
          { name: "BETTER_AUTH_SECRET" },
          { name: "PROVIDER_CREDENTIAL_KEY" },
          { name: "VAPID_PUBLIC_KEY" },
          { name: "VAPID_PRIVATE_KEY" }
        ])
      )
    ).not.toThrow();
  });

  it("names missing secrets without revealing configured values", () => {
    expect(() =>
      assertRequiredWorkerSecrets(JSON.stringify([{ name: "BETTER_AUTH_SECRET" }]))
    ).toThrow(
      "Deployment is missing required Worker secrets: PROVIDER_CREDENTIAL_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY."
    );
  });
});
