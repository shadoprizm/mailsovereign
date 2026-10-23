// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  draftRecoveryKey,
  readAccountDraftRecovery,
  readDraftRecovery
} from "@/features/compose/compose-state";
import {
  clearDraftRecovery,
  removeDraftRecovery,
  writeDraftRecovery
} from "@/features/compose/draft-recovery";
import { readInboxDensity } from "@/features/mobile/mobile-preferences";

describe("device data belongs to its account", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not recover another account's draft with the same draft id", () => {
    const first = draftRecoveryKey("same-draft", "account-one");
    const second = draftRecoveryKey("same-draft", "account-two");
    expect(writeDraftRecovery(first, { subject: "Synthetic draft", savedAt: 200 })).toBe(true);
    expect(readDraftRecovery(first, new Date(100).toISOString())?.subject).toBe("Synthetic draft");
    expect(readDraftRecovery(second, new Date(100).toISOString())).toBeNull();
  });

  it("migrates recovery for an authenticated owned draft without losing newer edits", () => {
    const owned = { id: "owned", updatedAt: new Date(100).toISOString() };
    const legacyKey = draftRecoveryKey(owned.id);
    const accountKey = draftRecoveryKey(owned.id, "account-one");
    writeDraftRecovery(legacyKey, { subject: "Legacy unsaved edit", savedAt: 300 });
    writeDraftRecovery(accountKey, { subject: "Older edit", savedAt: 200 });
    expect(readAccountDraftRecovery("account-one", owned)?.subject).toBe("Legacy unsaved edit");
    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(localStorage.getItem(accountKey)).toContain("Legacy unsaved edit");
    expect(
      readAccountDraftRecovery("account-two", {
        id: "different-owned-draft",
        updatedAt: owned.updatedAt
      })
    ).toBeNull();
  });

  it("keeps legacy recovery if the namespaced copy cannot be saved", () => {
    const owned = { id: "owned", updatedAt: new Date(100).toISOString() };
    const legacyKey = draftRecoveryKey(owned.id);
    writeDraftRecovery(legacyKey, { subject: "Recoverable edit", savedAt: 300 });
    const read = localStorage.getItem.bind(localStorage);
    vi.stubGlobal("localStorage", {
      getItem: read,
      setItem: () => {
        throw new Error("full");
      },
      removeItem: vi.fn()
    });
    expect(readAccountDraftRecovery("account-one", owned)?.subject).toBe("Recoverable edit");
    expect(read(legacyKey)).toContain("Recoverable edit");
    expect(readAccountDraftRecovery(null, owned)).toBeNull();
  });

  it("clears only draft recovery, including legacy recovery, on sign-out", () => {
    localStorage.setItem("sovereign-mail:compose:draft:legacy", "synthetic");
    writeDraftRecovery(draftRecoveryKey("one", "account-one"), { savedAt: 1 });
    writeDraftRecovery(draftRecoveryKey("two", "account-two"), { savedAt: 2 });
    localStorage.setItem("sovereign-mail:inbox-density:account-one", "compact");
    clearDraftRecovery();
    expect(localStorage.length).toBe(1);
    expect(readInboxDensity("account-one")).toBe("compact");
    expect(readInboxDensity("account-two")).toBe("comfortable");
  });

  it("allows editing and sign-out when device storage is blocked", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", {
      setItem: blocked,
      removeItem: blocked,
      getItem: blocked,
      get length() {
        return blocked();
      }
    });
    expect(writeDraftRecovery("draft", {})).toBe(false);
    expect(() => removeDraftRecovery("draft")).not.toThrow();
    expect(() => clearDraftRecovery()).not.toThrow();
    expect(readInboxDensity("account")).toBe("comfortable");
  });
});
