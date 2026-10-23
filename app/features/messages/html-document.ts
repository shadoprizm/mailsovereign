export function buildEmailHtmlDocument(input: {
  allowRemoteImages: boolean;
  html: string;
  origin: string;
}): string {
  const origin = new URL(input.origin).origin;
  const imageSources = input.allowRemoteImages ? `${origin} data: https: http:` : `${origin} data:`;
  const policy = `default-src 'none'; img-src ${imageSources}; font-src ${origin}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light only"><style>${baseStyles(origin)}</style></head><body>${input.html}</body></html>`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function baseStyles(origin: string): string {
  return `
  @font-face { font-family: "Geist Sans"; src: url("${origin}/fonts/Geist-Regular.woff2") format("woff2"); font-style: normal; font-weight: 400; font-display: swap; }
  :root { color-scheme: only light; background: #ffffff; }
  * { box-sizing: border-box; }
  html { overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; background: #ffffff; }
  body { margin: 0; padding: 0; background: #ffffff; color: #171717; font-family: "Geist Sans", ui-sans-serif, system-ui, sans-serif; font-size: 14px; line-height: 1.55; }
  [data-mail-image-placeholder] { display: inline-block; max-width: 100%; padding: 2px 6px; border: 1px solid #d4d4d4; border-radius: 3px; background: #f5f5f5; color: #525252; font: 12px/1.5 ui-sans-serif, system-ui, sans-serif; overflow-wrap: anywhere; }
  [data-mail-image-placeholder]::before { content: attr(aria-label); }
  a { color: #1d4ed8; }
  blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid #d4d4d4; }
`;
}
