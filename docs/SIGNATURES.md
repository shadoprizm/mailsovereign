# Email signatures

Sovereign Mail stores reusable signatures privately for each person. A signature can be assigned as
the default for any exact From address that person can send from, and the composer can override or
remove it on an individual draft.

## Authoring

Settings → Signatures offers two authoring paths:

- **Professional card** builds a two-panel branded signature from editable identity, organization,
  contact, and color fields. It shows a live preview and produces a table-based layout with inline
  styles so the result remains useful in email clients that do not load application CSS.
- **Simple rich text** keeps the compact editor for text, emphasis, lists, and links.

Professional cards use text and CSS colors only. They do not upload logos, reference remote images,
or move assets outside the customer's infrastructure. Optional phone, email, and website values are
rendered as `tel:`, `mailto:`, and HTTPS links respectively. Empty optional fields are omitted.

The generated HTML and its plain-text alternative are saved through the existing signature API. A
small private marker in the saved HTML identifies the professional-card version and its editable
field values. The server preserves only these known marker attributes while continuing to remove
scripts, event handlers, unsafe links, remote images, and unsupported markup.

## Compose and delivery

A selected signature is inserted as a protected block in the rich composer. Typing or formatting the
message around that block must not flatten its table layout or discard its inline styles. Changing the
From address or signature selection replaces only the protected signature block and preserves the
authored message and forwarded quote.

Before delivery, Sovereign Mail removes its private signature and professional-card markers. The
recipient receives ordinary table-based HTML plus the message's plain-text alternative; no private
signature IDs or editor configuration are sent.

Deleting a saved signature clears defaults that reference it. Existing draft body content remains,
but its saved signature selection is changed to no signature.
