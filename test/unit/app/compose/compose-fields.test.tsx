import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComposeFields } from "@/features/compose/compose-fields";

describe("compose fields", () => {
  it("renders editable reply recipients without hardcoded explanatory copy", () => {
    const html = renderToStaticMarkup(
      <ComposeFields
        bcc=""
        cc=""
        from="support@example.com"
        identities={[{ mailboxId: "mbx_1", address: "support@example.com" }]}
        mode="reply"
        signatures={[]}
        signatureChoice={{ mode: "none", signatureId: null }}
        defaultSignatureName={null}
        subject="Re: Account access"
        to="customer@example.com"
        setBcc={() => undefined}
        setCc={() => undefined}
        setFrom={() => undefined}
        setSubject={() => undefined}
        setSignatureChoice={() => undefined}
        setTo={() => undefined}
      />
    );

    expect(html).toContain('aria-label="To"');
    expect(html).toContain('aria-label="Cc"');
    expect(html).toContain('aria-label="Bcc"');
    expect(html.match(/type="email"/g)).toHaveLength(3);
    expect(html.match(/multiple=""/g)).toHaveLength(3);
    expect(html).toContain("Separate multiple addresses with commas.");
    expect(html).not.toContain("Replying to");
  });
});
