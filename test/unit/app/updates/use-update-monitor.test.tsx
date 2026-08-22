// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { announcePwaUpdateReady } from "@/features/pwa/update-ready";
import type { UpdateStatus } from "@/features/updates/types";
import { beginUpdateProgress } from "@/features/updates/update-progress";
import { useUpdateMonitor } from "@/features/updates/use-update-monitor";
import { flushHookEffects, renderHook } from "../render-hook";

const mocks = vi.hoisted(() => ({
  getUpdateStatus: vi.fn()
}));

vi.mock("@/features/updates/api", () => ({
  getUpdateStatus: mocks.getUpdateStatus
}));

const status: UpdateStatus = {
  product: "sovereign-mail",
  installedVersion: "0.1.22",
  installedSchemaVersion: 5,
  channel: "stable",
  checkedAt: "2026-07-29T00:00:00.000Z",
  available: true,
  compatible: true,
  release: {
    version: "0.1.23",
    schemaVersion: 5,
    publishedAt: "2026-07-29T00:00:00.000Z",
    notesUrl: "https://github.com/shadoprizm/mailsovereign/releases/tag/v0.1.23"
  }
};

describe("useUpdateMonitor", () => {
  it("checks while visible and removes refresh listeners when management is revoked", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible"
    });
    mocks.getUpdateStatus.mockResolvedValue(status);
    const hook = await renderHook(
      ({ canManage }: { canManage: boolean }) => {
        return useUpdateMonitor(canManage);
      },
      { canManage: true }
    );
    await flushHookEffects();

    expect(mocks.getUpdateStatus).toHaveBeenCalledOnce();
    expect(hook.result.status).toEqual(status);
    expect(hook.result.ready).toBe(false);
    await flushHookEffects(announcePwaUpdateReady);
    expect(hook.result.ready).toBe(true);
    await flushHookEffects(() => window.dispatchEvent(new Event("focus")));
    expect(mocks.getUpdateStatus).toHaveBeenCalledTimes(2);

    await hook.rerender({ canManage: false });
    expect(hook.result.status).toBeNull();
    await flushHookEffects(() => window.dispatchEvent(new Event("focus")));
    expect(mocks.getUpdateStatus).toHaveBeenCalledTimes(2);
    await hook.unmount();
    document.documentElement.removeAttribute("data-sovereign-mail-update-ready");
  });

  it("clears inherited update state when releases are disabled for a customized product", async () => {
    mocks.getUpdateStatus.mockClear();
    beginUpdateProgress("upstream-build");

    const hook = await renderHook(() => useUpdateMonitor(true, false), undefined);
    await flushHookEffects();

    expect(hook.result.status).toBeNull();
    expect(hook.result.progress).toBeNull();
    expect(mocks.getUpdateStatus).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
    await hook.unmount();
  });
});
