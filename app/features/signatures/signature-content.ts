import type { EmailSignature, SignatureChoice, SignaturePreferences } from "./types";

export const defaultSignatureChoice = (signatureId: string | null = null): SignatureChoice => ({
  mode: "default",
  signatureId
});

export function signatureForChoice(
  preferences: SignaturePreferences,
  senderAddress: string,
  choice: SignatureChoice
): EmailSignature | null {
  const signatureId =
    choice.mode === "specific"
      ? choice.signatureId
      : choice.mode === "default"
        ? preferences.defaults[senderAddress.toLowerCase()]
        : null;
  return preferences.signatures.find((signature) => signature.id === signatureId) ?? null;
}

export function signatureChoiceValue(choice: SignatureChoice): string {
  return choice.mode === "specific" && choice.signatureId
    ? `signature:${choice.signatureId}`
    : choice.mode;
}

export function parseSignatureChoice(value: string): SignatureChoice {
  if (value === "default") return defaultSignatureChoice();
  if (value === "none") return { mode: "none", signatureId: null };
  if (value.startsWith("signature:")) {
    return { mode: "specific", signatureId: value.slice("signature:".length) || null };
  }
  return { mode: "none", signatureId: null };
}

export function applySignatureToHtml(
  html: string,
  signature: EmailSignature | null,
  placement: "end" | "before-quote" = "end"
): string {
  const document = parseHtml(html || "<p></p>");
  const existing = [...document.body.querySelectorAll<HTMLElement>("[data-email-signature]")];
  const anchor = existing[0] ?? null;
  const parent = anchor?.parentNode ?? document.body;
  const nextSibling = anchor?.nextSibling ?? null;
  for (const element of existing) element.remove();

  if (signature) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-email-signature", signature.id);
    wrapper.innerHTML = `<p><br></p>${signature.html}`;
    if (anchor && parent.isConnected) {
      parent.insertBefore(wrapper, nextSibling);
    } else if (placement === "before-quote") {
      const quote = document.body.querySelector("blockquote");
      document.body.insertBefore(wrapper, quote);
    } else {
      document.body.appendChild(wrapper);
    }
  }
  return document.body.innerHTML || "<p></p>";
}

export function signatureTextFromHtml(html: string): string {
  const document = parseHtml(html);
  return plainText(document.body)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlForSending(html: string): string {
  const document = parseHtml(html);
  for (const element of document.body.querySelectorAll<HTMLElement>("[data-email-signature]")) {
    element.removeAttribute("data-email-signature");
  }
  return document.body.innerHTML;
}

export function editableMessageTextFromHtml(
  html: string,
  mode: "new" | "reply" | "forward"
): string {
  const document = parseHtml(html);
  removeNonProseContent(document, mode);
  return plainText(document.body)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function replaceEditableMessageTextInHtml(
  html: string,
  text: string,
  mode: "new" | "reply" | "forward"
): string {
  const document = parseHtml(html);
  const signature = topLevelChild(
    document.body,
    document.body.querySelector<HTMLElement>("[data-email-signature]")
  );
  const forwardedQuote = topLevelChild(
    document.body,
    mode === "forward" ? forwardedBlockquote(document) : null
  );
  const preserved = new Set<Node>();
  if (signature) preserved.add(signature);
  if (forwardedQuote) preserved.add(forwardedQuote);
  for (const node of [...document.body.childNodes]) {
    if (!preserved.has(node)) node.remove();
  }

  const anchor = signature ?? forwardedQuote;
  for (const paragraph of plainTextParagraphs(document, text)) {
    document.body.insertBefore(paragraph, anchor);
  }
  return document.body.innerHTML || "<p></p>";
}

function removeNonProseContent(document: Document, mode: "new" | "reply" | "forward"): void {
  for (const element of document.body.querySelectorAll<HTMLElement>("[data-email-signature]")) {
    element.remove();
  }
  if (mode === "forward") forwardedBlockquote(document)?.remove();
}

function forwardedBlockquote(document: Document): HTMLElement | null {
  const quotes = [...document.body.querySelectorAll<HTMLElement>("blockquote")];
  return (
    quotes.find((quote) => quote.textContent?.includes("---------- Forwarded message ---------")) ??
    quotes.at(-1) ??
    null
  );
}

function topLevelChild(body: HTMLElement, node: Node | null): ChildNode | null {
  let current = node;
  while (current?.parentNode && current.parentNode !== body) current = current.parentNode;
  return current?.parentNode === body ? (current as ChildNode) : null;
}

function plainTextParagraphs(document: Document, text: string): HTMLParagraphElement[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [document.createElement("p")];
  return normalized.split(/\n{2,}/).map((value) => {
    const paragraph = document.createElement("p");
    value.split("\n").forEach((line, index) => {
      if (index) paragraph.appendChild(document.createElement("br"));
      paragraph.appendChild(document.createTextNode(line));
    });
    return paragraph;
  });
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

const blockTags = new Set([
  "ADDRESS",
  "BLOCKQUOTE",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "OL",
  "P",
  "PRE",
  "TABLE",
  "TR",
  "UL"
]);

function plainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLBRElement) return "\n";
  let value = "";
  for (const child of node.childNodes) value += plainText(child);
  return node instanceof HTMLElement && blockTags.has(node.tagName) ? `${value}\n` : value;
}
