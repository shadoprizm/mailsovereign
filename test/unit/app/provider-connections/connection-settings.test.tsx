// @vitest-environment happy-dom
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderConnectionSettings } from "@/features/provider-connections/connection-settings";
import type { ProviderConnection } from "@/features/provider-connections/types";
import { flushHookEffects, renderComponent } from "../render-hook";

const mocks = vi.hoisted(() => ({
  listProviderConnections: vi.fn(),
  listProviderImportPurges: vi.fn(),
  verifyProviderConnection: vi.fn(),
  updateProviderCredentials: vi.fn(),
  success: vi.fn()
}));

vi.mock("@/features/provider-connections/api", () => ({
  deleteProviderConnection: vi.fn(),
  listProviderConnections: mocks.listProviderConnections,
  listProviderImportPurges: mocks.listProviderImportPurges,
  syncProviderConnection: vi.fn(),
  updateProviderImportScope: vi.fn(),
  updateProviderCredentials: mocks.updateProviderCredentials,
  verifyProviderConnection: mocks.verifyProviderConnection
}));

vi.mock("@/features/provider-connections/connection-dialog", () => ({
  ProviderConnectionDialog: ({
    onCreated
  }: {
    onCreated: (connection: ProviderConnection) => void;
  }): ReactElement => (
    <button onClick={() => onCreated(verifiedConnection)} type="button">
      Complete connection
    </button>
  )
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: mocks.success } }));

const connection: ProviderConnection = {
  id: "connection-1",
  providerId: "google-personal",
  kind: "imap-smtp",
  displayName: "Personal Gmail",
  mailboxAddress: "person@gmail.com",
  config: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    tls: "required",
    importSince: "2026-06-01"
  },
  credentialKeyVersion: 1,
  isEnabled: true,
  verifiedAt: null,
  lastSyncedAt: null,
  lastErrorCode: null,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  syncProgress: {
    phase: "not_started",
    importedMessages: 0,
    quarantinedMessages: 0,
    estimatedPercent: 0,
    estimatedRemainingUidPositions: 0
  }
};

const verifiedAt = "2026-09-10T01:00:00.000Z";
const verifiedConnection: ProviderConnection = { ...connection, verifiedAt };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProviderConnections.mockResolvedValue([connection]);
  mocks.listProviderImportPurges.mockResolvedValue([]);
  mocks.verifyProviderConnection.mockResolvedValue({
    imap: true,
    smtp: true,
    mailboxAddress: connection.mailboxAddress,
    verifiedAt,
    syncQueued: true
  });
});

describe("provider connection mailbox refresh", () => {
  it("keeps Gmail authentication failure guidance visible before first verification", async () => {
    mocks.listProviderConnections.mockResolvedValue([
      { ...connection, lastErrorCode: "IMAP_AUTH" }
    ]);
    const view = await renderComponent(<ProviderConnectionSettings onMailboxesChanged={vi.fn()} />);
    await flushHookEffects();
    expect(view.container.textContent).toContain("Needs attention");
    expect(view.container.textContent).toContain("person@gmail.com");
    expect(view.container.textContent).toContain("Create a Google app password");
    expect(
      view.container.querySelector('a[href="https://myaccount.google.com/apppasswords"]')
    ).not.toBeNull();
    expect(findButton(view.container, "Update password")).toBeDefined();
    await view.unmount();
  });

  it("retains a verification failure inline after the notification disappears", async () => {
    mocks.verifyProviderConnection.mockRejectedValueOnce(
      new Error("The mail provider rejected the connection credentials.")
    );
    const onMailboxesChanged = vi.fn();
    const view = await renderComponent(
      <ProviderConnectionSettings onMailboxesChanged={onMailboxesChanged} />
    );
    await flushHookEffects();
    await flushHookEffects(() => findButton(view.container, "Verify").click());
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      "rejected the connection credentials"
    );
    expect(view.container.textContent).toContain("Create a Google app password");
    expect(onMailboxesChanged).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("refreshes workspace mailboxes after verifying an existing connection", async () => {
    const onMailboxesChanged = vi.fn();
    const view = await renderComponent(
      <ProviderConnectionSettings onMailboxesChanged={onMailboxesChanged} />
    );
    await flushHookEffects();

    const verifyButton = findButton(view.container, "Verify");
    await flushHookEffects(() => verifyButton.click());

    expect(mocks.verifyProviderConnection).toHaveBeenCalledWith(connection.providerId);
    expect(onMailboxesChanged).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("refreshes workspace mailboxes after a newly created connection verifies", async () => {
    const onMailboxesChanged = vi.fn();
    const view = await renderComponent(
      <ProviderConnectionSettings onMailboxesChanged={onMailboxesChanged} />
    );
    await flushHookEffects();

    const completeButton = findButton(view.container, "Complete connection");
    await flushHookEffects(() => completeButton.click());

    expect(onMailboxesChanged).toHaveBeenCalledOnce();
    await view.unmount();
  });
});

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} button not found`);
  return button;
}
