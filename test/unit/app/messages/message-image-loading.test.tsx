// @vitest-environment happy-dom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageHtml } from "@/features/messages/message-html";
import type { MessageDetail } from "@/features/messages/types";
import { flushHookEffects, renderComponent } from "../render-hook";

const mocks = vi.hoisted(() => ({
  buildDocument: vi.fn(({ html }: { html: string }) => html),
  getMessageHtml: vi.fn(),
  trustRemoteMediaSender: vi.fn()
}));
vi.mock("@/features/messages/api", () => mocks);
vi.mock("@/features/messages/html-document", () => ({
  buildEmailHtmlDocument: mocks.buildDocument
}));
const message: MessageDetail = {
  id: "first",
  threadId: "thread",
  mailboxId: "mailbox",
  direction: "inbound",
  folder: "inbox",
  fromAddress: "sender@example.com",
  to: [],
  cc: [],
  bcc: [],
  subject: "Image loading",
  snippet: "plain",
  textBody: "plain",
  receivedAt: null,
  sentAt: null,
  readAt: null,
  starredAt: null,
  hasAttachments: false,
  createdAt: "2026-10-18T00:00:00Z",
  deliveredToAddress: null,
  htmlAvailable: true,
  messageId: null,
  inReplyTo: null,
  references: [],
  attachments: []
};
type HtmlResult = {
  html: string;
  quotedHtml: string | null;
  hasRemoteImages: boolean;
  remoteMediaTrusted: boolean;
};
const blocked: HtmlResult = {
  html: "<p>Blocked first</p>",
  quotedHtml: null,
  hasRemoteImages: true,
  remoteMediaTrusted: false
};
function button(container: HTMLElement, label: string) {
  const result = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label
  );
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}

describe("message image requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:https://mail.example.com/image-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disables both actions during a load and leaves failure retryable", async () => {
    let reject: (error: Error) => void = () => undefined;
    mocks.getMessageHtml.mockResolvedValueOnce(blocked).mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      })
    );
    const view = await renderComponent(<MessageHtml message={message} />);
    await flushHookEffects(() => button(view.container, "Load images").click());
    expect(button(view.container, "Load images").disabled).toBe(true);
    expect(button(view.container, "Always load from sender").disabled).toBe(true);
    await flushHookEffects(() => reject(new Error("network")));
    expect(view.container.textContent).toContain("Remote images could not be loaded. Try again.");
    expect(button(view.container, "Load images").disabled).toBe(false);
    await view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:https://mail.example.com/image-test");
  });

  it("cannot apply a late approved response after navigating to another message", async () => {
    let resolve: (result: HtmlResult) => void = () => undefined;
    mocks.getMessageHtml
      .mockResolvedValueOnce(blocked)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        })
      )
      .mockResolvedValueOnce({ ...blocked, html: "<p>Second message</p>" });
    let changeMessage: React.Dispatch<React.SetStateAction<MessageDetail>> = () => undefined;
    function Host() {
      const [current, setCurrent] = React.useState(message);
      changeMessage = setCurrent;
      return <MessageHtml message={current} />;
    }
    const view = await renderComponent(<Host />);
    const root = view.container;
    await flushHookEffects(() => button(root, "Load images").click());
    await flushHookEffects(() => changeMessage({ ...message, id: "second" }));
    await flushHookEffects(() =>
      resolve({ ...blocked, html: "<p>Late first message</p>", remoteMediaTrusted: true })
    );
    expect(mocks.buildDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        html: "<p>Second message</p>",
        allowRemoteImages: false
      })
    );
    expect(button(root, "Load images").disabled).toBe(false);
    await view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:https://mail.example.com/image-test");
  });
});
