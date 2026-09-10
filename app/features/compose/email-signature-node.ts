import { mergeAttributes, Node } from "@tiptap/core";

export const EmailSignature = Node.create({
  name: "emailSignature",
  group: "block",
  atom: true,
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      signatureId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-email-signature"),
        renderHTML: (attributes) =>
          attributes.signatureId ? { "data-email-signature": attributes.signatureId } : {}
      },
      signatureHtml: {
        default: "",
        parseHTML: (element) => element.innerHTML,
        rendered: false
      },
      signatureText: {
        default: "",
        parseHTML: (element) => signaturePlainText(element),
        rendered: false
      }
    };
  },
  parseHTML() {
    return [{ tag: "div[data-email-signature]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return signatureElement(
      mergeAttributes(HTMLAttributes, { "data-email-signature": node.attrs.signatureId }),
      node.attrs.signatureHtml
    );
  },
  renderText({ node }) {
    return typeof node.attrs.signatureText === "string" ? node.attrs.signatureText : "";
  },
  addNodeView() {
    const typeName = this.name;
    return ({ HTMLAttributes, node }) => {
      const dom = signatureElement(HTMLAttributes, node.attrs.signatureHtml);
      dom.contentEditable = "false";
      return {
        dom,
        ignoreMutation: () => true,
        update: (updatedNode) => {
          if (updatedNode.type.name !== typeName) return false;
          syncSignatureElement(
            dom,
            { "data-email-signature": updatedNode.attrs.signatureId },
            updatedNode.attrs.signatureHtml
          );
          dom.contentEditable = "false";
          return true;
        }
      };
    };
  }
});

function signatureElement(attributes: Record<string, unknown>, html: unknown): HTMLDivElement {
  const element = document.createElement("div");
  syncSignatureElement(element, attributes, html);
  return element;
}

function syncSignatureElement(
  element: HTMLDivElement,
  attributes: Record<string, unknown>,
  html: unknown
): void {
  for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined && value !== false) {
      element.setAttribute(name, String(value));
    }
  }
  element.innerHTML = safeSignatureHtml(typeof html === "string" ? html : "");
}

function safeSignatureHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll(
    "audio,base,button,embed,form,iframe,img,input,link,math,meta,object,option,script,select,source,style,svg,textarea,video"
  )) {
    element.remove();
  }
  for (const element of template.content.querySelectorAll<HTMLElement>("*")) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || attribute.name === "srcdoc") {
        element.removeAttribute(attribute.name);
      }
    }
    const href = element.getAttribute("href")?.trim();
    if (href && !isSafeSignatureLink(href)) element.removeAttribute("href");
    const style = element.getAttribute("style");
    if (
      style &&
      /(?:url\s*\(|image-set\s*\(|@import|expression\s*\(|javascript\s*:|data\s*:)/i.test(style)
    ) {
      element.removeAttribute("style");
    }
  }
  return template.innerHTML;
}

function isSafeSignatureLink(value: string): boolean {
  if (value.startsWith("#")) return true;
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const signatureBlockTags = new Set([
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
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL"
]);

function signaturePlainText(element: Element): string {
  return signatureNodeText(element)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function signatureNodeText(node: globalThis.Node): string {
  if (node.nodeType === globalThis.Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLBRElement) return "\n";
  let value = "";
  for (const child of node.childNodes) value += signatureNodeText(child);
  return node instanceof HTMLElement && signatureBlockTags.has(node.tagName) ? `${value}\n` : value;
}
