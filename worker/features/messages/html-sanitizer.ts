import sanitizeHtml from "sanitize-html";

import { extractEmbeddedStyles, safeStyleValue, sanitizeInlineStyles } from "./css-sanitizer";
import { createImagePolicy, type ImagePolicy, sanitizeImageSet } from "./image-policy";
import { isSafeInlineImage } from "./inline-media";
import { splitQuotedHtml } from "./quote-classifier";
import type { StoredAttachment } from "./types";

const allowedTags = [
  "a",
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "li",
  "main",
  "mark",
  "ol",
  "p",
  "picture",
  "source",
  "pre",
  "q",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul"
];

export type SanitizedMessageHtml = {
  hasRemoteImages: boolean;
  html: string;
  quotedHtml: string | null;
};

export function sanitizeMessageHtml(input: {
  allowRemoteImages: boolean;
  attachments: StoredAttachment[];
  html: string;
  messageId: string;
  origin: string;
  subject: string;
}): SanitizedMessageHtml {
  const imagePolicy = createImagePolicy(input);
  const prepared = extractEmbeddedStyles(input.html, imagePolicy.resolve);
  const parts = splitQuotedHtml(prepared.html, input.subject);
  const body = sanitizeDisplayHtml({
    ...input,
    imagePolicy,
    html: parts.body,
    styleSheet: prepared.styleSheet
  });
  const quote = parts.quote
    ? sanitizeDisplayHtml({
        ...input,
        imagePolicy,
        html: parts.quote,
        styleSheet: prepared.styleSheet
      })
    : null;
  return {
    hasRemoteImages: imagePolicy.hasRemoteImages,
    html: body.html,
    quotedHtml: quote?.html || null
  };
}

export function sanitizeQuotedMessageHtml(input: {
  attachments: Array<Pick<StoredAttachment, "contentId" | "contentType" | "id">>;
  html: string;
}): { html: string; inlineAttachmentIds: string[] } {
  const attachmentsByContentId = new Map(
    input.attachments.flatMap((attachment) =>
      attachment.contentId && isSafeInlineImage(attachment.contentType)
        ? [[normalizeContentId(attachment.contentId), attachment] as const]
        : []
    )
  );
  const inlineAttachmentIds = new Set<string>();
  const bounded = boundedHtml(input.html);
  const html = sanitizeHtml(bounded, {
    ...sanitizerOptions(),
    allowedSchemesByTag: {
      img: ["cid", "http", "https"]
    },
    transformTags: {
      "*": (tagName, attributes) => ({
        tagName,
        attribs: { ...attributes, style: sanitizeInlineStyles(attributes.style ?? "", () => null) }
      }),
      a: (tagName, attributes) => ({ tagName, attribs: safeLinkAttributes(attributes) }),
      img: (tagName, attributes) => {
        const source = attributes.src?.trim() ?? "";
        const next: sanitizeHtml.Attributes = { ...attributes };
        delete next.srcset;
        if (source.toLowerCase().startsWith("cid:")) {
          const attachment = attachmentsByContentId.get(normalizeContentId(source.slice(4)));
          if (attachment?.contentId) {
            const contentId = stripContentIdBrackets(attachment.contentId);
            inlineAttachmentIds.add(attachment.id);
            next.src = `cid:${contentId}`;
          } else {
            delete next.src;
          }
        } else {
          const remoteSource = absoluteRemoteUrl(source);
          if (remoteSource) {
            next.src = remoteSource;
            next.referrerpolicy = "no-referrer";
          } else {
            delete next.src;
          }
        }
        return { tagName, attribs: next };
      }
    }
  });
  return { html, inlineAttachmentIds: [...inlineAttachmentIds] };
}

export function sanitizeEmailSignatureHtml(html: string): string {
  return sanitizeHtml(html.slice(0, 20_000), {
    ...sanitizerOptions(true),
    allowedTags: allowedTags.filter((tag) => !["img", "source", "picture"].includes(tag)),
    transformTags: {
      "*": (tagName, attributes) => ({
        tagName,
        attribs: { ...attributes, style: sanitizeInlineStyles(attributes.style ?? "", () => null) }
      }),
      a: (tagName, attributes) => ({ tagName, attribs: safeLinkAttributes(attributes) })
    }
  });
}

function sanitizeDisplayHtml(input: {
  html: string;
  imagePolicy: ImagePolicy;
  styleSheet: string;
}): { html: string } {
  const resolve = input.imagePolicy.resolve;
  let pictureDepth = 0;
  let pictureFallback = "";
  const content = sanitizeHtml(input.html, {
    ...sanitizerOptions(),
    // Styles are parsed and sanitized in the transform below, including background URLs.
    parseStyleAttributes: false,
    onOpenTag(name) {
      if (name === "picture") {
        pictureDepth++;
        pictureFallback = "";
      }
    },
    onCloseTag(name) {
      if (name === "picture") {
        pictureDepth--;
        pictureFallback = "";
      }
    },
    allowedSchemesByTag: { img: ["http", "https", "data"], source: ["http", "https"] },
    transformTags: {
      "*": (tagName, attributes) => {
        let next = { ...attributes };
        delete next["data-mail-image-placeholder"];
        if (attributes.style) next.style = sanitizeInlineStyles(attributes.style, resolve);
        if (attributes.background) {
          const background = resolve(attributes.background);
          if (background) {
            next.style = `${next.style ?? ""};background-image:url("${background.replaceAll('"', "%22")}")`;
          }
          delete next.background;
        }
        if (tagName === "a") {
          const link = safeLinkAttributes(next);
          delete next.href;
          delete next.target;
          delete next.rel;
          next = { ...next, ...link };
        }
        if (tagName === "img" || tagName === "source") {
          const source = attributes.src?.trim() ?? "";
          const srcset = sanitizeImageSet(attributes.srcset ?? "", resolve);
          const candidate = srcset.split(/[,\s]/)[0] ?? "";
          if (tagName === "source" && pictureDepth > 0 && candidate) pictureFallback ||= candidate;
          const resolved =
            resolve(source) || candidate || (pictureDepth > 0 ? pictureFallback : "");
          delete next.src;
          delete next.srcset;
          if (srcset) next.srcset = srcset;
          if (tagName === "img") {
            if (resolved) {
              next.src = resolved;
              next.loading = "eager";
              next.referrerpolicy = "no-referrer";
            } else {
              // Sender-controlled attributes cannot manufacture our placeholder markers.
              return {
                tagName: "span",
                attribs: {
                  "data-mail-image-placeholder": "",
                  role: "img",
                  "aria-label":
                    attributes.alt ||
                    (input.imagePolicy.blocksRemote &&
                    /(?:https?:\/\/|\/\/)/i.test(`${source} ${attributes.srcset ?? ""}`)
                      ? "Remote image hidden"
                      : "Image unavailable")
                }
              };
            }
          }
        }
        return { tagName, attribs: next };
      }
    }
  });
  return { html: input.styleSheet ? `<style>${input.styleSheet}</style>${content}` : content };
}

function sanitizerOptions(includeSignatureMetadata = false): sanitizeHtml.IOptions {
  const commonAttributes = ["align", "class", "dir", "id", "lang", "style", "title", "valign"];
  return {
    allowProtocolRelative: false,
    allowedAttributes: {
      "*": includeSignatureMetadata
        ? [...commonAttributes, "data-signature-design", "data-sovereign-signature"]
        : commonAttributes,
      a: ["href", "rel", "target", "title"],
      col: ["span", "width"],
      img: ["alt", "height", "loading", "referrerpolicy", "src", "srcset", "title", "width"],
      source: ["srcset", "media", "type", "sizes"],
      span: ["data-mail-image-placeholder", "role", "aria-label"],
      li: ["value"],
      ol: ["start", "type"],
      table: ["align", "bgcolor", "border", "cellpadding", "cellspacing", "height", "width"],
      td: ["align", "bgcolor", "colspan", "height", "rowspan", "valign", "width"],
      th: ["align", "bgcolor", "colspan", "height", "rowspan", "scope", "valign", "width"]
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedTags,
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: false,
    nestingLimit: 80,
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "title"]
  };
}

function boundedHtml(html: string): string {
  const maxCharacters = 200_000;
  if (html.length <= maxCharacters) return html;
  return `${html.slice(0, maxCharacters)}<p>[Previous message truncated by Sovereign Mail]</p>`;
}

function absoluteRemoteUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function stripContentIdBrackets(value: string): string {
  return value.trim().replace(/^<|>$/g, "");
}

function safeLinkAttributes(attributes: sanitizeHtml.Attributes): sanitizeHtml.Attributes {
  const href = attributes.href?.trim();
  const style = attributes.style?.trim();
  const presentation = {
    ...(style && safeStyleValue.test(style) ? { style } : {}),
    title: attributes.title ?? ""
  };
  if (!href || (!href.startsWith("#") && !isSafeLink(href))) {
    return presentation;
  }
  if (href.startsWith("#")) return { href, ...presentation };
  return {
    href,
    rel: "noopener noreferrer",
    target: "_blank",
    ...presentation
  };
}

function isSafeLink(value: string): boolean {
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function normalizeContentId(value: string): string {
  const decoded = safeDecode(value).trim().replace(/^<|>$/g, "");
  return decoded.toLowerCase();
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
