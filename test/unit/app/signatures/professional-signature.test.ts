// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  buildProfessionalSignature,
  defaultProfessionalSignatureDesign,
  professionalSignatureDesignFromHtml
} from "@/features/signatures/professional-signature";

describe("professional email signatures", () => {
  it("builds an email-safe card and plain-text alternative from editable fields", () => {
    const design = {
      ...defaultProfessionalSignatureDesign(),
      brand: "Astra",
      tagline: "Software Development & Digital Systems",
      parentOrganization: "North Star Holdings",
      fullName: "Jeramy Ratelle",
      jobTitle: "Software Developer",
      phone: "613 985 0878",
      email: "jeramy@example.com",
      website: "astrawebdev.com"
    };

    const signature = buildProfessionalSignature(design);

    expect(signature.html).toContain('data-sovereign-signature="professional-card-v1"');
    expect(signature.html).toContain("<table");
    expect(signature.html).toContain('href="tel:6139850878"');
    expect(signature.html).toContain('href="mailto:jeramy@example.com"');
    expect(signature.html).toContain('href="https://astrawebdev.com/"');
    expect(signature.text).toBe(
      "Jeramy Ratelle\nSoftware Developer\nAstra\nSoftware Development & Digital Systems\nA division of North Star Holdings\n613 985 0878\njeramy@example.com\nastrawebdev.com"
    );
    expect(professionalSignatureDesignFromHtml(signature.html)).toEqual(design);
  });

  it("escapes visible values and does not link unsupported website protocols", () => {
    const signature = buildProfessionalSignature({
      ...defaultProfessionalSignatureDesign(),
      brand: '<script data-test="brand">',
      fullName: "Jeramy & team",
      website: "javascript:alert(1)"
    });

    expect(signature.html).not.toContain("<script data-test");
    expect(signature.html).toContain("&lt;script data-test=&quot;brand&quot;&gt;");
    expect(signature.html).toContain("Jeramy &amp; team");
    expect(signature.html).not.toContain('href="javascript:');
  });
});
