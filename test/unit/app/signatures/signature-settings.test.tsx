// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  buildProfessionalSignature,
  defaultProfessionalSignatureDesign
} from "@/features/signatures/professional-signature";
import { SignatureSettings } from "@/features/signatures/signature-settings";
import { flushHookEffects, renderComponent } from "../render-hook";

const mocks = vi.hoisted(() => ({
  createSignature: vi.fn(),
  deleteSignature: vi.fn(),
  listSignaturePreferences: vi.fn(),
  updateSignature: vi.fn(),
  updateSignatureDefault: vi.fn()
}));

vi.mock("@/features/signatures/api", () => mocks);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("signature settings", () => {
  it("reopens saved professional cards as editable fields with a live preview", async () => {
    const content = buildProfessionalSignature({
      ...defaultProfessionalSignatureDesign(),
      brand: "Astra",
      fullName: "Jeramy Ratelle",
      tagline: "Software Development & Digital Systems",
      website: "astrawebdev.com"
    });
    mocks.listSignaturePreferences.mockResolvedValue({
      signatures: [
        {
          id: "sig-work",
          name: "Astra",
          ...content,
          createdAt: "2026-09-10T12:00:00.000Z",
          updatedAt: "2026-09-10T12:00:00.000Z"
        }
      ],
      defaults: {}
    });

    const view = await renderComponent(<SignatureSettings mailboxes={[]} />);
    await flushHookEffects();

    expect(view.container.textContent).toContain("Professional card design");
    expect(view.container.textContent).toContain("Professional signature preview");
    expect(view.container.textContent).toContain("Jeramy Ratelle");
    expect(view.container.textContent).toContain("Software Development & Digital Systems");
    expect(
      view.container.querySelector<HTMLInputElement>('input[autocomplete="name"]')?.value
    ).toBe("Jeramy Ratelle");
    expect(view.container.querySelector<HTMLInputElement>('input[autocomplete="url"]')?.value).toBe(
      "astrawebdev.com"
    );

    await view.unmount();
  });
});
