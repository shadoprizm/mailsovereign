import { isSafeInlineImage } from "./inline-media";
import type { StoredAttachment } from "./types";

export function createImagePolicy(input: {
  allowRemoteImages: boolean;
  attachments: StoredAttachment[];
  messageId: string;
  origin: string;
}) {
  const origin = new URL(input.origin);
  if (!["http:", "https:"].includes(origin.protocol))
    throw new Error("Invalid application origin.");
  const attachments = new Map(
    input.attachments.flatMap((attachment) =>
      attachment.contentId && isSafeInlineImage(attachment.contentType)
        ? [[normalizeContentId(attachment.contentId), attachment.id] as const]
        : []
    )
  );
  let hasRemoteImages = false;
  function resolve(source: string): string | null {
    const value = source.trim();
    if (/^cid:/i.test(value)) {
      const attachmentId = attachments.get(normalizeContentId(value.slice(4)));
      return attachmentId
        ? `${origin.origin}/api/messages/${encodeURIComponent(input.messageId)}/inline/${encodeURIComponent(attachmentId)}`
        : null;
    }
    // Only bounded raster data is displayable; SVG/HTML and arbitrary data URLs are rejected.
    if (/^data:/i.test(value)) {
      return value.length <= 2_000_000 &&
        /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value)
        ? value
        : null;
    }
    if (!/^(?:https?:\/\/|\/\/)/i.test(value)) return null;
    try {
      const url = new URL(value, origin);
      if (url.username || url.password || url.origin === origin.origin) return null;
      hasRemoteImages = true;
      return input.allowRemoteImages ? url.href : null;
    } catch {
      return null;
    }
  }
  return {
    resolve,
    blocksRemote: !input.allowRemoteImages,
    get hasRemoteImages() {
      return hasRemoteImages;
    }
  };
}

export type ImagePolicy = ReturnType<typeof createImagePolicy>;

export function sanitizeImageSet(value: string, resolve: ImagePolicy["resolve"]): string {
  if (value.length > 20_000) return "";
  return value
    .split(",")
    .slice(0, 20)
    .flatMap((candidate) => {
      const [source, descriptor, ...extra] = candidate.trim().split(/\s+/);
      if (
        !source ||
        /^data:/i.test(source) ||
        extra.length ||
        (descriptor && !/^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor)) ||
        (descriptor && Number.parseFloat(descriptor) <= 0)
      )
        return [];
      const url = resolve(source);
      return url ? [`${url}${descriptor ? ` ${descriptor}` : ""}`] : [];
    })
    .join(", ");
}

function normalizeContentId(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Literal malformed percent escapes may occur in MIME content IDs.
  }
  return decoded.trim().replace(/^<|>$/g, "").toLowerCase();
}
