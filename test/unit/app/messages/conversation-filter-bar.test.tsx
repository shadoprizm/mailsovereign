// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { ConversationFilterBar } from "@/features/messages/conversation-filter-bar";
import { ConversationFilterPanel } from "@/features/messages/conversation-filter-panel";
import { createEmptyConversationFilters } from "@/features/messages/conversation-filters";
import { flushHookEffects, renderComponent } from "../render-hook";

describe("conversation filter bar", () => {
  it("shows removable criteria and clears the complete filter", async () => {
    const onChange = vi.fn();
    const onLabelChange = vi.fn();
    const filters = {
      ...createEmptyConversationFilters(),
      attachments: "with" as const,
      from: "billing@example.com",
      read: "unread" as const
    };
    const view = await renderComponent(
      <ConversationFilterBar
        activeLabelId="label-priority"
        filters={filters}
        labels={[
          {
            color: "red",
            conversationCount: 2,
            id: "label-priority",
            isSystem: true,
            name: "Priority"
          }
        ]}
        onChange={onChange}
        onLabelChange={onLabelChange}
      />
    );

    expect(view.container.textContent).toContain("From: billing@example.com");
    expect(view.container.textContent).toContain("Unread");
    expect(view.container.textContent).toContain("Has attachments");
    expect(view.container.textContent).toContain("Label: Priority");

    const removeFrom = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove filter: From: billing@example.com"]'
    );
    if (!removeFrom) throw new Error("Expected the sender filter chip.");
    await flushHookEffects(() => removeFrom.click());
    expect(onChange).toHaveBeenCalledWith({ ...filters, from: "" });

    const clearAll = [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Clear all"
    );
    if (!clearAll) throw new Error("Expected the clear filters action.");
    await flushHookEffects(() => clearAll.click());
    expect(onChange).toHaveBeenLastCalledWith(createEmptyConversationFilters());
    expect(onLabelChange).toHaveBeenCalledWith(null);
    await view.unmount();
  });

  it("applies quick filters from the responsive panel", async () => {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();
    const view = await renderComponent(
      <ConversationFilterPanel
        activeLabelId={null}
        filters={createEmptyConversationFilters()}
        labels={[]}
        open
        onApply={onApply}
        onOpenChange={onOpenChange}
      />
    );

    const unread = findButton(document.body, "Unread");
    await flushHookEffects(() => unread.click());
    expect(unread.getAttribute("aria-pressed")).toBe("true");
    await flushHookEffects(() => findButton(document.body, "Apply filters").click());

    expect(onApply).toHaveBeenCalledWith(
      { ...createEmptyConversationFilters(), read: "unread" },
      null
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await view.unmount();
  });
});

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text
  );
  if (!button) throw new Error(`Expected button: ${text}`);
  return button;
}
