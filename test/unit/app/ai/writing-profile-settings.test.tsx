// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { WritingProfileSettings } from "@/features/ai/writing-profile-settings";
import { flushHookEffects, renderComponent } from "../render-hook";

const mocks = vi.hoisted(() => ({
  getAiWritingProfile: vi.fn(),
  updateAiWritingProfile: vi.fn()
}));

vi.mock("@/features/ai/api", () => ({
  getAiWritingProfile: mocks.getAiWritingProfile,
  updateAiWritingProfile: mocks.updateAiWritingProfile
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("AI writing profile settings", () => {
  it("lets each user start and explicitly save a Markdown voice profile", async () => {
    mocks.getAiWritingProfile.mockResolvedValue({ markdown: "", updatedAt: null });
    mocks.updateAiWritingProfile.mockImplementation(async (markdown: string) => ({
      markdown,
      updatedAt: "2026-08-22T12:00:00.000Z"
    }));
    const view = await renderComponent(<WritingProfileSettings />);
    await flushHookEffects();

    expect(view.container.textContent).toContain("Private Markdown instructions");
    const starter = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Use starter template")
    );
    await flushHookEffects(() => starter?.click());
    const save = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Save writing profile")
    );
    await flushHookEffects(() => save?.click());

    expect(mocks.updateAiWritingProfile).toHaveBeenCalledWith(
      expect.stringContaining("## Examples that sound like me")
    );
    expect(mocks.updateAiWritingProfile).toHaveBeenCalledWith(
      expect.stringContaining("## Replies")
    );

    await view.unmount();
  });
});
