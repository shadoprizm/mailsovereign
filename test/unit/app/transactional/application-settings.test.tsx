// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationSettings } from "@/features/transactional/application-settings";
import { CredentialPanel } from "@/features/transactional/credential-panel";
import { flushHookEffects, renderComponent } from "../render-hook";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  apiGet: mocks.get,
  apiPost: mocks.post,
  apiPut: mocks.put,
  apiDelete: mocks.remove
}));
const application = {
  id: "app1",
  name: "Reusable app",
  workspace_id: "workspace",
  description: "",
  status: "active",
  per_minute: 30,
  per_day: 500,
  created_at: "2026-09-13T12:00:00Z",
  updated_at: "2026-09-13T12:00:00Z",
  last_used_at: null
};
const address = { id: "addr1", address: "sender@example.com", mailbox_id: "mailbox" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockImplementation(async (path: string) =>
    path.endsWith("/addresses")
      ? [address]
      : path.endsWith("/app1")
        ? { application, grants: [], credentials: [], sends: [] }
        : [application]
  );
});
describe("service application settings", () => {
  it("shows conservative quotas and requires explicit From grants", async () => {
    const view = await renderComponent(<ApplicationSettings />);
    expect(view.container.querySelector<HTMLInputElement>('[name="perMinute"]')?.value).toBe("30");
    expect(view.container.querySelector<HTMLInputElement>('[name="perDay"]')?.value).toBe("500");
    const select = view.container.querySelector("select") as HTMLSelectElement;
    await flushHookEffects(() => {
      select.value = "app1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const grant = [...view.container.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("sender@example.com"))
      ?.querySelector("input") as HTMLInputElement;
    expect(grant.checked).toBe(false);
    await flushHookEffects(() => grant.click());
    expect(mocks.post).toHaveBeenCalledWith("/api/service-applications/app1/grants", {
      address: "sender@example.com"
    });
    await view.unmount();
  });
  it("shows a secret only after creation and discards it on dismiss and remount", async () => {
    const testSecret = "smk_test-secret-for-ui-only";
    mocks.post.mockResolvedValue({ secret: testSecret });
    const props = {
      applicationId: "app1",
      credentials: [],
      disabled: false,
      onChanged: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn()
    };
    const view = await renderComponent(<CredentialPanel {...props} />);
    const name = view.container.querySelector<HTMLInputElement>(
      '[name="name"]'
    ) as HTMLInputElement;
    name.value = "Named key";
    await flushHookEffects(() =>
      view.container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(mocks.post).toHaveBeenCalledWith("/api/service-applications/app1/credentials", {
      name: "Named key",
      scopes: ["transactional.send"],
      expiresAt: null
    });
    expect(
      view.container.querySelector<HTMLInputElement>('[aria-label="New API secret shown once"]')
        ?.value
    ).toBe(testSecret);
    const dismiss = [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "I've saved it"
    );
    await flushHookEffects(() => dismiss?.click());
    expect(view.container.querySelector('[aria-label="New API secret shown once"]')).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain(testSecret);
    expect(JSON.stringify(sessionStorage)).not.toContain(testSecret);
    await view.unmount();
    const remount = await renderComponent(<CredentialPanel {...props} />);
    expect(remount.container.querySelector('[aria-label="New API secret shown once"]')).toBeNull();
    await remount.unmount();
  });
});
