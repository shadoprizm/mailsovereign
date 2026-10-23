import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../../../../worker/features/transactional/service";
import { parseTransactional } from "../../../../../worker/features/transactional/validation";
import { message } from "./fixture";

describe("transactional message validation", () => {
  it("preserves responsive HTML, text and safe unsubscribe headers exactly", () => {
    expect(parseTransactional(message)).toEqual(message);
    expect(canonicalJson({ a: 1, b: [2, 3] })).toBe(canonicalJson({ b: [2, 3], a: 1 }));
  });
  it.each([
    { html: "" },
    { text: " \n" },
    { html: "<script>alert(1)</script>" },
    { html: '<img src="x" onerror="alert(1)">' },
    { html: '<a href="java&#x73;cript:alert(1)">bad</a>' },
    { html: '<a href="java&#10;script:alert(1)">bad</a>' },
    { html: '<iframe srcdoc="bad"></iframe>' },
    { html: '<form action="https://example.com"><input></form>' },
    { html: "<style>body{width:expression(alert(1))}</style>" },
    { html: '<p style="width:expression(alert(1))">bad</p>' },
    { html: '<meta http-equiv="refresh" content="0;url=https://example.com">' },
    { from: { email: "bad@@example.com" } },
    { from: { email: "Somebody <sender@example.com>" } },
    { to: [{ email: "a@example.net\r\nBcc: b@example.net" }] },
    { to: [{ email: "a@example.net", name: 'a" <b@example.net>' }] },
    { subject: "Hello\r\nBcc: bad@example.net" },
    { headers: { Bcc: "bad@example.net" } },
    { headers: { "List-Unsubscribe": "<https://example.com>\r\nBcc: bad@example.net" } },
    { headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } },
    { headers: { "List-Unsubscribe": "<javascript:alert(1)>" } },
    { to: Array.from({ length: 51 }, () => ({ email: "a@example.net" })) },
    {
      to: Array.from({ length: 25 }, () => ({ email: "a@example.net" })),
      cc: Array.from({ length: 26 }, () => ({ email: "b@example.net" }))
    },
    { unexpected: true }
  ])("rejects unsafe or malformed input %#", (change) => {
    expect(() => parseTransactional({ ...message, ...change })).toThrow();
  });
});
