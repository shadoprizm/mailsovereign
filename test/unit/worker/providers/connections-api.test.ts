import {
  createProviderConnectionSchema,
  resetProviderCursorSchema
} from "@worker/features/provider-connections/validation";
import { describe, expect, it } from "vitest";

const valid = {
  providerId: "mxroute-primary",
  displayName: "MXRoute primary",
  config: {
    imapHost: "imap.mxrouting.net",
    imapPort: 993,
    smtpHost: "smtp.mxrouting.net",
    smtpPort: 465,
    tls: "required"
  },
  username: "Ops@Example.com",
  password: "correct-horse-battery-staple"
};

describe("provider connection API validation", () => {
  it("normalizes the mailbox username and accepts only explicit TLS", () => {
    expect(createProviderConnectionSchema.parse(valid)).toMatchObject({
      providerId: "mxroute-primary",
      username: "ops@example.com",
      config: { tls: "required" }
    });
  });

  it("rejects credential smuggling, unknown fields, and unbounded passwords", () => {
    expect(() =>
      createProviderConnectionSchema.parse({
        ...valid,
        config: { ...valid.config, password: "smuggled" }
      })
    ).toThrow();
    expect(() => createProviderConnectionSchema.parse({ ...valid, token: "smuggled" })).toThrow();
    expect(() =>
      createProviderConnectionSchema.parse({ ...valid, password: "x".repeat(1025) })
    ).toThrow();
  });

  it("limits cursor recovery to the inbox handled by this executor slice", () => {
    expect(resetProviderCursorSchema.parse({ folderPath: "INBOX" })).toEqual({
      folderPath: "INBOX"
    });
    expect(() => resetProviderCursorSchema.parse({ folderPath: "Sent" })).toThrow();
  });
});
