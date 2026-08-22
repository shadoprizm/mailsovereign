// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { ComposeAi } from "@/features/ai/compose-ai";
import { flushHookEffects, renderComponent } from "../render-hook";

const mocks = vi.hoisted(() => ({
  runComposeAiAction: vi.fn()
}));

vi.mock("@/features/ai/api", () => ({
  runComposeAiAction: mocks.runComposeAiAction
}));

describe("Sovereign AI composer", () => {
  it("keeps the current draft untouched until the user accepts a proposal", async () => {
    mocks.runComposeAiAction.mockResolvedValue({
      requestId: "request-1",
      feature: "compose_draft",
      model: "fast",
      text: "A warmer, clearer message.",
      creditsCharged: 2,
      creditsRemaining: 298
    });
    const onUseProposal = vi.fn();
    const view = await renderComponent(
      <ComposeAi
        currentText="My unchanged draft."
        from="person@example.com"
        messageId={null}
        mode="new"
        subject="Hello"
        to={["recipient@example.net"]}
        onUseProposal={onUseProposal}
      />
    );

    const disclosure = view.container.querySelector<HTMLButtonElement>("[aria-expanded]");
    await flushHookEffects(() => disclosure?.click());
    const create = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Create proposal")
    );
    await flushHookEffects(() => create?.click());

    expect(mocks.runComposeAiAction).toHaveBeenCalledWith(
      expect.objectContaining({ currentText: "My unchanged draft.", model: "fast" })
    );
    expect(onUseProposal).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("A warmer, clearer message.");
    expect(view.container.textContent).toContain("current draft remains untouched");

    const accept = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Use proposal")
    );
    await flushHookEffects(() => accept?.click());
    expect(onUseProposal).toHaveBeenCalledWith("A warmer, clearer message.");

    await view.unmount();
  });
});
