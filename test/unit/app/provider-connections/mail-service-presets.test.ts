import { describe, expect, it } from "vitest";

import {
  applyMailServicePreset,
  connectionIdSuggestion,
  detectMailService,
  getMailServicePreset,
  isMailServiceId
} from "@/features/provider-connections/mail-service-presets";

describe("mail service presets", () => {
  it("fills the secure Gmail endpoints", () => {
    const preset = getMailServicePreset("google");
    if (!preset) throw new Error("The Google preset is missing.");
    expect(
      applyMailServicePreset(
        { imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "465" },
        preset
      )
    ).toEqual({
      imapHost: "imap.gmail.com",
      imapPort: "993",
      smtpHost: "smtp.gmail.com",
      smtpPort: "465"
    });
  });

  it("keeps MXroute hostnames manual while filling its stable secure ports", () => {
    const preset = getMailServicePreset("mxroute");
    if (!preset) throw new Error("The MXroute preset is missing.");
    expect(
      applyMailServicePreset(
        {
          imapHost: "eagle.mxlogin.com",
          imapPort: "143",
          smtpHost: "eagle.mxlogin.com",
          smtpPort: "587"
        },
        preset
      )
    ).toEqual({
      imapHost: "eagle.mxlogin.com",
      imapPort: "993",
      smtpHost: "eagle.mxlogin.com",
      smtpPort: "465"
    });
  });

  it.each([
    ["person@gmail.com", "google"],
    ["person@me.com", "icloud"],
    ["person@yahoo.ca", "yahoo"],
    ["person@fastmail.com", "fastmail"],
    ["person@zoho.com", "zoho-personal"],
    ["person@aol.com", "aol"],
    ["person@example.com", null]
  ])("detects %s as %s", (email, expected) => {
    expect(detectMailService(email)).toBe(expected);
  });

  it("generates a valid editable connection ID suggestion", () => {
    expect(connectionIdSuggestion("google", "Jeramy.Ratelle+mail@gmail.com")).toBe(
      "google-jeramy-ratelle-mail"
    );
    expect(isMailServiceId("namecheap-private-email")).toBe(true);
    expect(isMailServiceId("microsoft-365")).toBe(false);
  });
});
