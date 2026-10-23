import postcss from "postcss";

import type { ImagePolicy } from "./image-policy";

export const allowedStyleProperties = [
  "background",
  "background-image",
  "background-position",
  "background-repeat",
  "background-size",
  "background-color",
  "border",
  "border-bottom",
  "border-bottom-color",
  "border-bottom-style",
  "border-bottom-width",
  "border-collapse",
  "border-color",
  "border-left",
  "border-left-color",
  "border-left-style",
  "border-left-width",
  "border-radius",
  "border-right",
  "border-right-color",
  "border-right-style",
  "border-right-width",
  "border-spacing",
  "border-style",
  "border-top",
  "border-top-color",
  "border-top-style",
  "border-top-width",
  "border-width",
  "box-sizing",
  "clear",
  "color",
  "display",
  "float",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "height",
  "letter-spacing",
  "line-height",
  "list-style-position",
  "list-style-type",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "opacity",
  "overflow-wrap",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration",
  "text-indent",
  "text-transform",
  "vertical-align",
  "white-space",
  "width",
  "word-break"
];

export const safeStyleValue =
  /^(?!.*(?:url\s*\(|image-set\s*\(|@import|expression\s*\(|javascript\s*:|data\s*:|var\s*\())[^\\]*$/i;

const embeddedStyleTag = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const safeStylesheetSelector = /^(?!.*(?:\\|<\/?style|@))[-_a-z0-9\s.#,:>+~*()]+$/i;
const safeMediaQuery =
  /^(?!.*(?:\\|<|>|url\s*\(|@import|expression\s*\(|javascript\s*:|data\s*:|var\s*\())[-_a-z0-9\s(),:./]+$/i;
const stylesheetProperties = new Set([
  ...allowedStyleProperties,
  "-moz-osx-font-smoothing",
  "-webkit-font-smoothing",
  "align-items",
  "background",
  "box-shadow",
  "gap",
  "justify-content",
  "list-style",
  "overflow",
  "position"
]);

export function extractEmbeddedStyles(
  html: string,
  resolveImage?: ImagePolicy["resolve"]
): { html: string; styleSheet: string } {
  const styleSheets: string[] = [];
  const content = html.replace(embeddedStyleTag, (_match, source: string) => {
    const sanitized = sanitizeStyleSheet(source, resolveImage);
    if (sanitized) styleSheets.push(sanitized);
    return "";
  });
  return { html: content, styleSheet: styleSheets.join("\n") };
}

function sanitizeStyleSheet(source: string, resolveImage?: ImagePolicy["resolve"]): string {
  if (!source.trim() || source.length > 50_000) return "";

  try {
    const root = postcss.parse(source);
    root.walkComments((comment) => {
      comment.remove();
    });
    root.walkAtRules((rule) => {
      if (
        rule.name.toLowerCase() !== "media" ||
        rule.params.length > 500 ||
        !safeMediaQuery.test(rule.params)
      ) {
        rule.remove();
      }
    });
    root.walkRules((rule) => {
      if (rule.selector.length > 1_000 || !safeStylesheetSelector.test(rule.selector)) {
        rule.remove();
      }
    });
    root.walkDecls((declaration) => {
      const property = declaration.prop.toLowerCase();
      const value = sanitizeCssValue(property, declaration.value.trim(), resolveImage);
      const unsafePosition =
        property === "position" &&
        (value === null || !/^(?:absolute|relative|static)$/i.test(value));
      if (
        declaration.parent?.type !== "rule" ||
        !stylesheetProperties.has(property) ||
        value === null ||
        unsafePosition
      ) {
        declaration.remove();
      } else {
        declaration.value = value;
      }
    });
    root.walkRules((rule) => {
      if (!rule.nodes?.length) rule.remove();
    });
    root.walkAtRules((rule) => {
      if (!rule.nodes?.length) rule.remove();
    });
    return root.toString().trim();
  } catch {
    return "";
  }
}

// Parse declarations before allowing URL-bearing background properties. Other properties retain
// the strict resource-free policy. Escapes and unrecognized URL syntax fail closed.
export function sanitizeInlineStyles(source: string, resolveImage: ImagePolicy["resolve"]): string {
  try {
    const root = postcss.parse(`email { ${source} }`);
    const rule = root.first;
    if (root.nodes.length !== 1 || rule?.type !== "rule" || rule.selector !== "email") return "";
    const declarations: string[] = [];
    for (const node of rule.nodes) {
      if (node.type !== "decl") continue;
      const property = node.prop.toLowerCase();
      if (!allowedStyleProperties.includes(property)) continue;
      const value = sanitizeCssValue(property, node.value, resolveImage);
      if (value !== null)
        declarations.push(`${property}:${value}${node.important ? " !important" : ""}`);
    }
    return declarations.join(";");
  } catch {
    return "";
  }
}

function sanitizeCssValue(
  property: string,
  value: string,
  resolveImage?: ImagePolicy["resolve"]
): string | null {
  if (
    value.length > 10_000 ||
    /[<>\\]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    return null;
  if (safeStyleValue.test(value)) return value;
  if (!resolveImage || !["background", "background-image"].includes(property)) return null;
  let invalid = false;
  const urls: string[] = [];
  const rest = value.replace(
    /url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'()\\]+))\s*\)/gi,
    (
      _match,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
      bare: string | undefined
    ) => {
      const url = resolveImage(doubleQuoted ?? singleQuoted ?? bare ?? "");
      if (!url) invalid = true;
      urls.push(url ?? "");
      return "none";
    }
  );
  if (invalid || !urls.length || !safeStyleValue.test(rest)) return null;
  let index = 0;
  return value.replace(
    /url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"'()\\]+))\s*\)/gi,
    () => `url("${(urls[index++] ?? "").replaceAll('"', "%22")}")`
  );
}
