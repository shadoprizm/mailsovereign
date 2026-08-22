// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  applySignatureToHtml,
  defaultSignatureChoice,
  editableMessageTextFromHtml,
  htmlForSending,
  parseSignatureChoice,
  replaceEditableMessageTextInHtml,
  signatureForChoice,
  signatureTextFromHtml
} from "@/features/signatures/signature-content";
import type { EmailSignature, SignaturePreferences } from "@/features/signatures/types";

const personal: EmailSignature = {
  id: "sig-personal",
  name: "Personal",
  html: "<p>Jeramy</p><p>Personal note</p>",
  text: "Jeramy\nPersonal note",
  createdAt: "2026-08-18T12:00:00.000Z",
  updatedAt: "2026-08-18T12:00:00.000Z"
};
const business: EmailSignature = {
  ...personal,
  id: "sig-business",
  name: "Business",
  html: "<p><strong>Jeramy</strong></p><p>Astra Web Dev</p>",
  text: "Jeramy\nAstra Web Dev"
};
const preferences: SignaturePreferences = {
  signatures: [personal, business],
  defaults: {
    "personal@example.com": personal.id,
    "work@example.com": business.id
  }
};

describe("composer signature content", () => {
  it("resolves defaults by the exact From address and lets a manual choice override them", () => {
    expect(signatureForChoice(preferences, "work@example.com", defaultSignatureChoice())?.id).toBe(
      business.id
    );
    expect(
      signatureForChoice(preferences, "work@example.com", {
        mode: "specific",
        signatureId: personal.id
      })?.id
    ).toBe(personal.id);
    expect(
      signatureForChoice(preferences, "other@example.com", defaultSignatureChoice())
    ).toBeNull();
    expect(parseSignatureChoice(`signature:${business.id}`)).toEqual({
      mode: "specific",
      signatureId: business.id
    });
  });

  it("replaces only the marked signature block and keeps authored content", () => {
    const initial = applySignatureToHtml("<p>Hello there</p>", personal);
    const replaced = applySignatureToHtml(initial, business);

    expect(replaced).toContain("Hello there");
    expect(replaced).not.toContain("Personal note");
    expect(replaced).toContain("Astra Web Dev");
    expect(replaced.match(/data-email-signature/g)).toHaveLength(1);
    expect(signatureTextFromHtml(replaced)).toBe("Hello there\n\nJeramy\nAstra Web Dev");
  });

  it("puts a signature before forwarded content and removes private draft metadata for sending", () => {
    const draftHtml = applySignatureToHtml(
      "<p>See below</p><blockquote>Forwarded message</blockquote>",
      business,
      "before-quote"
    );

    expect(draftHtml.indexOf("data-email-signature")).toBeLessThan(
      draftHtml.indexOf("<blockquote>")
    );
    const outgoing = htmlForSending(draftHtml);
    expect(outgoing).not.toContain("data-email-signature");
    expect(outgoing).toContain("Astra Web Dev");
  });

  it("replaces only editable prose when an AI proposal is accepted", () => {
    const draftHtml = applySignatureToHtml(
      "<p>Old introduction</p><blockquote>Forwarded message</blockquote>",
      business,
      "before-quote"
    );

    expect(editableMessageTextFromHtml(draftHtml, "forward")).toBe("Old introduction");
    const replaced = replaceEditableMessageTextInHtml(
      draftHtml,
      "A warmer introduction.\n\n<script>not HTML</script>",
      "forward"
    );

    expect(replaced).not.toContain("Old introduction");
    expect(replaced).toContain("A warmer introduction.");
    expect(replaced).toContain("&lt;script&gt;not HTML&lt;/script&gt;");
    expect(replaced).toContain("data-email-signature");
    expect(replaced).toContain("Astra Web Dev");
    expect(replaced).toContain("<blockquote>Forwarded message</blockquote>");
    expect(editableMessageTextFromHtml(replaced, "forward")).toBe(
      "A warmer introduction.\n<script>not HTML</script>"
    );
  });
});
