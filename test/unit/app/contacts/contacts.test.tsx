import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContactsPage } from "@/features/contacts/contacts-page";
import {
  RecipientInput,
  recipientQuery,
  replaceRecipientSegment
} from "@/features/contacts/recipient-input";

describe("contacts interface", () => {
  it("renders private contact management and portable import and export actions", () => {
    const html = renderToStaticMarkup(<ContactsPage search="" />);

    expect(html).toContain("Contacts");
    expect(html).toContain("Your private address book");
    expect(html).toContain("Import");
    expect(html).toContain("Export");
    expect(html).toContain("New contact");
    expect(html).toContain("Loading contacts");
  });

  it("keeps recipient entry compatible with arbitrary comma-separated addresses", () => {
    expect(recipientQuery("one@example.com, ad")).toBe("ad");
    expect(replaceRecipientSegment("one@example.com, ad", "ada@example.net")).toBe(
      "one@example.com, ada@example.net"
    );
    expect(replaceRecipientSegment("unfinished", "saved@example.net")).toBe("saved@example.net");

    const html = renderToStaticMarkup(
      <RecipientInput
        aria-label="To"
        multiple
        type="email"
        value="person@"
        onValueChange={() => undefined}
      />
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('type="email"');
    expect(html).toContain('multiple=""');
  });
});
