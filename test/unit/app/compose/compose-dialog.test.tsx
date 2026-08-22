// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposeDialog } from "@/features/compose/compose-dialog";
import type { Draft } from "@/features/drafts/types";
import type { Mailbox } from "@/features/mailboxes/types";
import { flushHookEffects, renderComponent } from "../render-hook";

const mocks = vi.hoisted(() => ({
  composeFormProps: null as Record<string, unknown> | null,
  createDraft: vi.fn(),
  deleteDraft: vi.fn(),
  initializeAutosave: vi.fn(),
  listDrafts: vi.fn(),
  listSignaturePreferences: vi.fn(),
  resetAutosave: vi.fn()
}));

vi.mock("@/features/drafts/api", () => ({
  createDraft: mocks.createDraft,
  deleteDraft: mocks.deleteDraft,
  deleteDraftAttachment: vi.fn(),
  listDrafts: mocks.listDrafts,
  uploadDraftAttachment: vi.fn()
}));
vi.mock("@/features/signatures/api", () => ({
  listSignaturePreferences: mocks.listSignaturePreferences
}));
vi.mock("@/features/compose/compose-form", () => ({
  ComposeForm: (props: Record<string, unknown>) => {
    mocks.composeFormProps = props;
    return null;
  }
}));
vi.mock("@/features/compose/compose-surface", () => ({
  ComposeSurface: ({ children }: { children: React.ReactNode }) => children
}));
vi.mock("@/features/compose/use-draft-autosave", () => ({
  useDraftAutosave: () => ({
    initializeAutosave: mocks.initializeAutosave,
    resetAutosave: mocks.resetAutosave
  })
}));
vi.mock("@/features/compose/api", () => ({ replyToMessage: vi.fn(), sendMessage: vi.fn() }));
vi.mock("@/lib/notification-sounds", () => ({ playNotificationSound: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const mailbox: Mailbox = {
  id: "mailbox-1",
  address: "sender@example.com",
  displayName: "Sender",
  isActive: true,
  accessLevel: "manager",
  createdAt: "now",
  updatedAt: "now",
  addresses: [
    {
      id: "address-1",
      mailboxId: "mailbox-1",
      mailDomainId: "domain-1",
      address: "sender@example.com",
      displayName: "Sender",
      receiveEnabled: true,
      sendEnabled: true,
      isPrimary: true
    }
  ]
};

const existingDraft: Draft = {
  id: "existing-draft",
  mailboxId: mailbox.id,
  replyToMessageId: null,
  forwardOfMessageId: null,
  signatureMode: "none",
  signatureId: null,
  from: mailbox.address,
  to: ["friend@example.com"],
  cc: [],
  bcc: [],
  subject: "Existing subject",
  text: "Existing body",
  html: "<p>Existing body</p>",
  version: 1,
  updatedAt: "2026-08-22T18:00:00.000Z",
  attachments: []
};

describe("compose dialog", () => {
  beforeEach(() => {
    mocks.composeFormProps = null;
    mocks.createDraft.mockReset();
    mocks.deleteDraft.mockReset();
    mocks.initializeAutosave.mockReset();
    mocks.listDrafts.mockReset();
    mocks.listSignaturePreferences.mockReset();
    mocks.resetAutosave.mockReset();
    mocks.listDrafts.mockResolvedValue([existingDraft]);
    mocks.listSignaturePreferences.mockResolvedValue({ signatures: [], defaults: {} });
    mocks.createDraft.mockResolvedValue({
      ...existingDraft,
      id: "fresh-draft",
      to: [],
      subject: "",
      text: "",
      html: ""
    });
    mocks.deleteDraft.mockResolvedValue(undefined);
  });

  it("starts a fresh blank message instead of reopening an existing ordinary draft", async () => {
    const view = await renderComponent(
      <ComposeDialog
        defaultFromMailboxId={mailbox.id}
        mailboxes={[mailbox]}
        open
        onOpenChange={() => undefined}
        onSent={() => undefined}
      />
    );
    await flushHookEffects();

    expect(mocks.listDrafts).not.toHaveBeenCalled();
    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ to: [], cc: [], bcc: [], subject: "" })
    );
    expect(mocks.composeFormProps).toMatchObject({
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      ready: true
    });

    await view.unmount();
  });

  it("confirms before discarding the saved draft", async () => {
    const onOpenChange = vi.fn();
    const view = await renderComponent(
      <ComposeDialog
        defaultFromMailboxId={mailbox.id}
        draftId={existingDraft.id}
        mailboxes={[mailbox]}
        open
        onOpenChange={onOpenChange}
        onSent={() => undefined}
      />
    );
    await flushHookEffects();

    expect(mocks.deleteDraft).not.toHaveBeenCalled();
    await flushHookEffects(() => {
      (mocks.composeFormProps?.onDiscard as (() => void) | undefined)?.();
    });
    const discardButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Discard draft"
    );
    expect(discardButton).toBeDefined();
    expect(mocks.deleteDraft).not.toHaveBeenCalled();

    await flushHookEffects(() => discardButton?.click());
    expect(mocks.deleteDraft).toHaveBeenCalledWith(existingDraft.id);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await view.unmount();
  });
});
