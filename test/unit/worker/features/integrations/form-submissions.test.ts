import { parseRawEmail } from "@worker/email/parse-email";
import {
  buildFormSubmissionEmail,
  formSubmissionSchema,
  secretMatches
} from "@worker/features/integrations/form-submissions";
import { describe, expect, it } from "vitest";

const submission = formSubmissionSchema.parse({
  submissionId: "contact_01K4N4WQ70M8V7N5X2K3",
  name: "Élodie Example",
  email: "elodie@example.com",
  subject: "Website inquiry — Élodie Example",
  text: "A plain-text message with useful details.",
  html: '<html><body><p style="color:#c9a75e">A polished message.</p></body></html>'
});

describe("form submission integration", () => {
  it("builds a standards-based multipart inbound email", async () => {
    const raw = buildFormSubmissionEmail(
      submission,
      "hello@northstarholdings.ca",
      new Date("2026-09-13T16:00:00.000Z")
    );
    const parsed = await parseRawEmail(raw);

    expect(parsed.fromAddress).toBe("elodie@example.com");
    expect(parsed.to).toEqual(["hello@northstarholdings.ca"]);
    expect(parsed.subject).toBe("Website inquiry — Élodie Example");
    expect(parsed.textBody).toContain("plain-text message");
    expect(parsed.htmlBody).toContain("A polished message.");
    expect(parsed.messageId).toBe("<form-contact_01K4N4WQ70M8V7N5X2K3@northstarholdings.ca>");
    expect(new TextDecoder().decode(raw)).toContain("Reply-To: elodie@example.com");
  });

  it("compares integration secrets without accepting near matches", async () => {
    await expect(secretMatches("correct-token", "correct-token")).resolves.toBe(true);
    await expect(secretMatches("correct-token", "correct-token-x")).resolves.toBe(false);
  });

  it("rejects extra fields and invalid idempotency keys", () => {
    expect(formSubmissionSchema.safeParse({ ...submission, submissionId: "bad id" }).success).toBe(
      false
    );
    expect(
      formSubmissionSchema.safeParse({ ...submission, destination: "other@example.com" }).success
    ).toBe(false);
  });
});
