import {
  sanitizeMessageHtml,
  sanitizeQuotedMessageHtml
} from "@worker/features/messages/html-sanitizer";
import { describe, expect, it } from "vitest";

const attachment = {
  id: "att-logo",
  messageId: "msg-1",
  filename: "logo.png",
  contentType: "image/png",
  sizeBytes: 120,
  contentId: "<signature-logo@example.com>",
  r2Key: "messages/logo.png",
  createdAt: "2026-07-13T00:00:00.000Z"
};

describe("email HTML sanitizer", () => {
  it("keeps basic formatting and resolves same-message CID images", () => {
    const result = sanitizeMessageHtml({
      allowRemoteImages: false,
      attachments: [attachment],
      origin: "https://mail.example.com",
      html: `<table style="width: 100%; color: #222; position: fixed">
        <tr><td><strong>Hello</strong></td></tr>
      </table><img src="cid:signature-logo%40example.com" onerror="alert(1)">`,
      messageId: "msg-1",
      subject: "Hello"
    });

    expect(result.hasRemoteImages).toBe(false);
    expect(result.html).toContain("<table");
    expect(result.html).toContain("width:100%");
    expect(result.html).toContain("color:#222");
    expect(result.html).not.toContain("position");
    expect(result.html).toContain("https://mail.example.com/api/messages/msg-1/inline/att-logo");
    expect(result.html).not.toContain("onerror");
  });

  it("removes active content, unsafe links, redirects, and CSS resource loads", () => {
    const result = sanitizeMessageHtml({
      allowRemoteImages: false,
      attachments: [],
      origin: "https://mail.example.com",
      html: `<title>Hidden metadata</title>
        <meta http-equiv="refresh" content="0;url=https://evil.example">
        <style>@import "https://evil.example/font.css";</style>
        <script>alert(1)</script><form action="https://evil.example"><input></form>
        <iframe src="https://evil.example"></iframe><object data="https://evil.example"></object>
        <a href="javascript:alert(1)" onclick="alert(1)">unsafe</a>
        <a href="https://example.com/path">safe</a>
        <p style="background-image:url(https://evil.example/pixel); color: red">Text</p>`,
      messageId: "msg-1",
      subject: "Hello"
    });

    expect(result.hasRemoteImages).toBe(true);
    expect(result.html).not.toMatch(/<script|<form|<input|<iframe|<object|<meta|<style/i);
    expect(result.html).not.toContain("evil.example");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("Hidden metadata");
    expect(result.html).toContain('href="https://example.com/path"');
    expect(result.html).toContain('target="_blank"');
    expect(result.html).toContain("color:red");
  });

  it("retains safe embedded presentation rules without allowing CSS resource loads", () => {
    const result = sanitizeMessageHtml({
      allowRemoteImages: false,
      attachments: [],
      origin: "https://mail.example.com",
      html: `<style>
        @import "https://evil.example/font.css";
        @font-face { font-family: tracker; src: url("https://evil.example/font.woff2"); }
        #message-shell, .message-shell strong {
          background: linear-gradient(135deg, #020617, #0f172a);
          color: #f8fafc !important;
          position: fixed;
          background-image: url("https://evil.example/pixel.gif");
        }
        @media only screen and (max-width: 600px) {
          .message-shell { padding: 16px !important; }
        }
      </style><div class="message-shell" id="message-shell"><strong>Readable</strong></div>`,
      messageId: "msg-1",
      subject: "Hello"
    });

    expect(result.hasRemoteImages).toBe(true);
    expect(result.html).toContain("<style>");
    expect(result.html).toContain('class="message-shell"');
    expect(result.html).toContain('id="message-shell"');
    expect(result.html).toContain(".message-shell");
    expect(result.html).toContain("linear-gradient(135deg, #020617, #0f172a)");
    expect(result.html).toContain("color: #f8fafc !important");
    expect(result.html).toContain("@media only screen and (max-width: 600px)");
    expect(result.html).not.toContain("@import");
    expect(result.html).not.toContain("@font-face");
    expect(result.html).not.toContain("position: fixed");
    expect(result.html).not.toContain("url(");
    expect(result.html).not.toContain("evil.example");
  });

  it("blocks remote images until the user loads them", () => {
    const blocked = sanitizeMessageHtml({
      allowRemoteImages: false,
      attachments: [],
      origin: "https://mail.example.com",
      html: '<img src="https://images.example.com/open.gif" srcset="https://images.example.com/2x.png 2x">',
      messageId: "msg-1",
      subject: "Hello"
    });
    const loaded = sanitizeMessageHtml({
      allowRemoteImages: true,
      attachments: [],
      origin: "https://mail.example.com",
      html: '<img src="//images.example.com/open.gif">',
      messageId: "msg-1",
      subject: "Hello"
    });

    expect(blocked.hasRemoteImages).toBe(true);
    expect(blocked.html).not.toContain("images.example.com");
    expect(blocked.html).toContain("Remote image hidden");
    expect(loaded.html).toContain('src="https://images.example.com/open.gif"');
    expect(loaded.html).toContain('referrerpolicy="no-referrer"');
  });

  it("detects remote srcset content even without a src attribute", () => {
    const result = sanitizeMessageHtml({
      allowRemoteImages: false,
      attachments: [],
      origin: "https://mail.example.com",
      html: '<img srcset="https://images.example.com/open.gif 1x">',
      messageId: "msg-1",
      subject: "Hello"
    });

    expect(result.hasRemoteImages).toBe(true);
    expect(result.html).not.toContain("images.example.com");
  });

  it("separates Gmail-compatible quoted history for reader disclosure", () => {
    const result = sanitizeMessageHtml({
      allowRemoteImages: false,
      attachments: [],
      origin: "https://mail.example.com",
      html: `<p>New reply</p><div class="gmail_quote gmail_quote_container"><div class="gmail_attr">On Tuesday, Pat wrote:</div><blockquote class="gmail_quote"><strong>Earlier reply</strong></blockquote></div>`,
      messageId: "msg-1",
      subject: "Re: Hello"
    });

    expect(result.html).toBe("<p>New reply</p>");
    expect(result.quotedHtml).toContain("<strong>Earlier reply</strong>");
    expect(result.quotedHtml).toContain('class="gmail_quote gmail_quote_container"');
  });

  it.each([
    ["without an authored introduction", ""],
    ["after an authored introduction", "<p>For your information</p>"]
  ])("keeps a Gmail forward visible %s", (_description, introduction) => {
    const result = sanitizeMessageHtml({
      allowRemoteImages: false,
      attachments: [],
      origin: "https://mail.example.com",
      html: `${introduction}<div class="gmail_quote gmail_quote_container"><div class="gmail_attr">---------- Forwarded message ---------<br>From: The Google Workspace Team &lt;workspace-noreply@google.com&gt;<br>Subject: Promotional access</div><table><tbody><tr><td><strong>Forwarded promotion</strong></td></tr></tbody></table></div>`,
      messageId: "msg-1",
      subject: "Fwd: Promotional access"
    });

    expect(result.html).toContain("---------- Forwarded message ---------");
    expect(result.html).toContain("<strong>Forwarded promotion</strong>");
    if (introduction) expect(result.html).toContain("For your information");
    expect(result.quotedHtml).toBeNull();
  });

  it("still collapses forwarded content when it is quoted by a reply", () => {
    const result = sanitizeMessageHtml({
      allowRemoteImages: false,
      attachments: [],
      origin: "https://mail.example.com",
      html: `<p>New reply</p><div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ---------</div><strong>Earlier forward</strong></div>`,
      messageId: "msg-1",
      subject: "Re: Promotional access"
    });

    expect(result.html).toBe("<p>New reply</p>");
    expect(result.quotedHtml).toContain("Earlier forward");
  });

  it("preserves safe rich HTML, remote images, and referenced CID images for outbound quotes", () => {
    const result = sanitizeQuotedMessageHtml({
      attachments: [attachment],
      html: `<script>alert(1)</script><table style="width: 100%; position: fixed"><tbody><tr><td><strong>Rich reply</strong></td></tr></tbody></table>
        <img src="cid:signature-logo@example.com" onerror="alert(1)">
        <img src="https://images.example.com/banner.png">
        <img src="cid:missing@example.com">`
    });

    expect(result.html).toContain("<table");
    expect(result.html).toContain("<strong>Rich reply</strong>");
    expect(result.html).toContain('src="cid:signature-logo@example.com"');
    expect(result.html).toContain('src="https://images.example.com/banner.png"');
    expect(result.html).not.toContain("position");
    expect(result.html).not.toContain("onerror");
    expect(result.html).not.toContain("missing@example.com");
    expect(result.inlineAttachmentIds).toEqual(["att-logo"]);
  });
});

const imageInput = {
  allowRemoteImages: false,
  attachments: [attachment],
  origin: "https://mail.example.com",
  messageId: "msg-1",
  subject: "Image compatibility"
};

describe("image compatibility and privacy", () => {
  it("gates srcset-only, picture, CSS, and table images together", () => {
    const html = `<style>.banner { background-image: url('https://images.example.com/style.png'); }</style>
      <picture><source media="(min-width: 600px)" srcset="//images.example.com/wide.png 2x"><img alt="Responsive" srcset="https://images.example.com/small.png 1x, https://images.example.com/large.png 2x"></picture>
      <div class="banner" style="background:url(https://images.example.com/inline.png) center / cover no-repeat; height:30px">Banner</div>
      <table background="https://images.example.com/table.png"><tr><td>Legacy</td></tr></table>`;
    const blocked = sanitizeMessageHtml({ ...imageInput, html });
    expect(blocked.hasRemoteImages).toBe(true);
    expect(blocked.html).not.toContain("images.example.com");
    expect(blocked.html).toContain("data-mail-image-placeholder");
    expect(blocked.html).not.toContain("<img");
    const loaded = sanitizeMessageHtml({ ...imageInput, html, allowRemoteImages: true });
    for (const name of ["style", "wide", "small", "large", "inline", "table"]) {
      expect(loaded.html).toContain(`https://images.example.com/${name}.png`);
    }
    expect(loaded.html).toContain('src="https://images.example.com/small.png"');
    expect(loaded.html).toContain('loading="eager"');
  });

  it("keeps an image element for picture sources without an img fallback URL", () => {
    const result = sanitizeMessageHtml({
      ...imageInput,
      allowRemoteImages: true,
      html: '<picture><source srcset="https://images.example.com/picture.png 1x"><img alt="Picture only"></picture>'
    });
    expect(result.html).toContain('<img alt="Picture only"');
    expect(result.html).toContain('src="https://images.example.com/picture.png"');
  });

  it("loads safe embedded raster images without remote permission", () => {
    const data = "data:image/png;base64,iVBORw0KGgo=";
    const result = sanitizeMessageHtml({
      ...imageInput,
      html: `<img src="cid:signature-logo%40example.com"><img src="${data}"><div style="background-image:url(cid:signature-logo@example.com)">Embedded background</div>`
    });
    expect(result.hasRemoteImages).toBe(false);
    expect(result.html).toContain(data);
    expect(result.html.match(/\/inline\/att-logo/g)).toHaveLength(2);
  });

  it("rejects unsafe or unresolvable images even after approval", () => {
    const result = sanitizeMessageHtml({
      ...imageInput,
      allowRemoteImages: true,
      attachments: [{ ...attachment, contentType: "image/svg+xml" }],
      html: `<img src="cid:signature-logo@example.com"><img src="data:image/svg+xml;base64,PHN2Zz4=">
        <img src="javascript:alert(1)"><img src="/api/admin/anything">
        <img src="https://user:password@images.example.com/private.png">
        <img srcset="javascript:alert(1) 1x, data:text/html;base64,AAA 2x">
        <div style="background-image:url(javascript:alert(1));color:red">Safe text</div>
        <style>.escape { background-image: u\\72l(https://evil.example/track); } @font-face { src:url(https://evil.example/font); }</style>`
    });
    expect(result.html).not.toMatch(
      /src=|srcset=|\/inline\/|evil\.example|password@|javascript:|data:image\/svg/
    );
    expect(result.html).toContain("Image unavailable");
    expect(result.html).toContain("color:red");
  });

  it("detects stylesheet-only images and applies permission to quoted images", () => {
    const result = sanitizeMessageHtml({
      ...imageInput,
      html: `<style>.banner { background-image:url(https://images.example.com/background.png); }</style><p>Reply</p><div class="gmail_quote"><img src="https://images.example.com/quote.png"></div>`,
      subject: "Re: Image compatibility"
    });
    expect(result.hasRemoteImages).toBe(true);
    expect(result.html).not.toContain("images.example.com");
    expect(result.quotedHtml).toContain("Remote image hidden");
  });
});
