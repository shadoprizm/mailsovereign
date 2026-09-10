// @vitest-environment happy-dom
import { generateHTML, generateJSON, generateText } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { EmailSignature } from "@/features/compose/email-signature-node";

const extensions = [StarterKit, EmailSignature];

describe("rich email signature blocks", () => {
  it("round-trips designed markup as an atomic block and keeps its text alternative", () => {
    const source =
      '<p>Hello</p><div data-email-signature="sig-work"><p><br></p><table style="background-color:#0f172a"><tbody><tr><td><strong>Jeramy</strong></td><td>Astra Web Dev</td></tr></tbody></table></div>';

    const document = generateJSON(source, extensions);
    const signature = document.content?.find(
      (node: { type?: string }) => node.type === "emailSignature"
    );

    expect(signature?.attrs).toMatchObject({ signatureId: "sig-work" });
    expect(signature?.attrs?.signatureHtml).toContain("<table");
    expect(generateHTML(document, extensions)).toContain(
      '<table style="background-color:#0f172a">'
    );
    expect(generateText(document, extensions)).toContain("Jeramy\nAstra Web Dev");
  });

  it("removes executable markup before a protected signature is rendered", () => {
    const source =
      '<div data-email-signature="sig-work"><img src="x" onerror="alert(1)"><a href="javascript:alert(1)" onclick="alert(1)">Unsafe</a><p>Safe</p></div>';
    const document = generateJSON(source, extensions);
    const rendered = generateHTML(document, extensions);

    expect(rendered).not.toContain("<img");
    expect(rendered).not.toContain("javascript:");
    expect(rendered).not.toContain("onclick");
    expect(rendered).toContain("Safe");
  });
});
