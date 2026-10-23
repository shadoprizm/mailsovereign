// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkOrganizationDialog } from "@/features/organization/bulk-organization-dialog";
import type { BulkOrganizationRun } from "@/features/organization/types";
import { flushHookEffects, renderComponent } from "../render-hook";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  current: vi.fn(),
  availability: vi.fn(),
  start: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}));

vi.mock("@/features/organization/api", () => ({
  applyBulkOrganization: mocks.apply,
  currentBulkOrganization: mocks.current,
  getBulkOrganizationAvailability: mocks.availability,
  retryBulkOrganization: vi.fn(),
  startBulkOrganization: mocks.start,
  undoBulkOrganization: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess }
}));

const completed: BulkOrganizationRun = {
  id: "orgbulk-1",
  model: "fast",
  status: "completed",
  totalCount: 1_470,
  processedCount: 1_470,
  suggestedCount: 1_420,
  creditsCharged: 1_470,
  lastErrorCode: null,
  createdAt: "2026-09-13T12:00:00.000Z",
  completedAt: "2026-09-13T12:20:00.000Z",
  labelCounts: [
    {
      count: 120,
      label: {
        id: "label-account",
        name: "Account & security",
        color: "red",
        isSystem: true,
        conversationCount: 120
      }
    }
  ]
};

describe("full inbox organization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.current.mockResolvedValue(null);
    mocks.availability.mockResolvedValue({ newCount: 2, totalCount: 1472 });
    mocks.start.mockResolvedValue({ ...completed, status: "queued", processedCount: 0 });
    mocks.apply.mockResolvedValue({
      affected: 1_420,
      run: { ...completed, status: "applied" }
    });
  });

  it("defaults to only new mail and estimates only that work", async () => {
    const view = await renderComponent(
      <BulkOrganizationDialog
        open
        onChanged={vi.fn(async () => undefined)}
        onOpenChange={vi.fn()}
      />
    );

    expect(document.body.textContent).toContain("2 conversations will be analyzed");
    await clickBodyButton("Organize 2 new");
    expect(mocks.start).toHaveBeenCalledWith("fast", "new");
    await view.unmount();
  });

  it("offers an explicit full-inbox reorganization option", async () => {
    mocks.current.mockResolvedValue({ ...completed, status: "applied" });
    const view = await renderComponent(
      <BulkOrganizationDialog open onChanged={vi.fn()} onOpenChange={vi.fn()} />
    );
    const all = document.body.querySelector<HTMLInputElement>('input[value="all"]');
    if (!all) throw new Error("Expected entire-inbox option");
    await flushHookEffects(() => all.click());
    expect(document.body.textContent).toContain("1,472 conversations will be analyzed");
    await clickBodyButton("Reorganize all 1,472");
    expect(mocks.start).toHaveBeenCalledWith("fast", "all");
    await view.unmount();
  });

  it("shows caught up and disables new-mail organization when no new conversations exist", async () => {
    mocks.current.mockResolvedValue({ ...completed, status: "applied" });
    mocks.availability.mockResolvedValue({ newCount: 0, totalCount: 1472 });
    const view = await renderComponent(
      <BulkOrganizationDialog open onChanged={vi.fn()} onOpenChange={vi.fn()} />
    );
    expect(document.body.textContent).toContain("You’re caught up.");
    const start = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Organize 0 new"
    );
    expect(start?.disabled).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("does not substitute the entire inbox when counts cannot be loaded", async () => {
    mocks.availability.mockRejectedValueOnce(new Error("Counts unavailable"));
    const view = await renderComponent(
      <BulkOrganizationDialog open onChanged={vi.fn()} onOpenChange={vi.fn()} />
    );
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("Counts unavailable");
    const start = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Organize 0 new"
    );
    expect(start?.disabled).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("shows aggregate review before applying a completed run", async () => {
    mocks.current.mockResolvedValue(completed);
    const onChanged = vi.fn(async () => undefined);
    const view = await renderComponent(
      <BulkOrganizationDialog open onChanged={onChanged} onOpenChange={vi.fn()} />
    );

    expect(document.body.textContent).toContain("1,420 conversations have clear label suggestions");
    expect(document.body.textContent).toContain("Account & security");
    await clickBodyButton("Apply reviewed labels");
    expect(mocks.apply).toHaveBeenCalledWith("orgbulk-1");
    expect(onChanged).toHaveBeenCalledOnce();
    await view.unmount();
  });
});

async function clickBodyButton(label: string): Promise<void> {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label
  );
  if (!button) throw new Error(`Expected button: ${label}`);
  await flushHookEffects(() => button.click());
}
