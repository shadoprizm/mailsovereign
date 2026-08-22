// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { DeleteConversationDialog } from "@/features/messages/delete-conversation-dialog";
import { flushHookEffects, renderComponent } from "../render-hook";

describe("permanent conversation deletion dialog", () => {
  it("requires confirmation before running the deletion", async () => {
    const onConfirm = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();
    const view = await renderComponent(
      <DeleteConversationDialog open onConfirm={onConfirm} onOpenChange={onOpenChange} />
    );
    const deleteButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Delete permanently"
    );

    expect(deleteButton).toBeDefined();
    expect(onConfirm).not.toHaveBeenCalled();
    await flushHookEffects(() => deleteButton?.click());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await view.unmount();
  });
});
