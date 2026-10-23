import { AppError, toAppError } from "@worker/lib/errors";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  mailboxes: vi.fn(),
  update: vi.fn(),
  audit: vi.fn()
}));
vi.mock("@worker/auth/session", () => ({ requireAuthContext: mocks.auth }));
vi.mock("@worker/auth/mailbox-access", () => ({
  accessibleMailboxIds: mocks.mailboxes,
  requireMailboxAccess: vi.fn()
}));
vi.mock("@worker/features/messages/conversation-bulk-read", () => ({
  updateMatchingConversationReadState: mocks.update
}));
vi.mock("@worker/features/audit/service", () => ({ recordAudit: mocks.audit }));
const { conversationRoutes } = await import("@worker/features/messages/conversation-routes");
const app = new Hono();
app.onError((error) => {
  const parsed = toAppError(error);
  return new Response(parsed.message, { status: parsed.status });
});
app.route("/", conversationRoutes);
const db = {};
function request(body: unknown) {
  return app.request(
    "/bulk-read-state",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    },
    { DB: db }
  );
}

describe("all matching conversation read-state route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1", role: "member" } });
    mocks.mailboxes.mockResolvedValue(["allowed"]);
    mocks.update.mockResolvedValue({ conversationCount: 125, affected: 150 });
  });

  it("derives permissions and label ownership from the session and audits only counts", async () => {
    const filters = {
      folder: "inbox",
      mailboxId: "allowed",
      labelId: "private",
      search: "test",
      read: "unread"
    };
    const response = await request({ action: "read", filters });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversationCount: 125, affected: 150 });
    expect(mocks.mailboxes).toHaveBeenCalledWith(db, "user-1", "member", "read");
    expect(mocks.update).toHaveBeenCalledWith(
      db,
      { ...filters, mailboxIds: ["allowed"], labelUserId: "user-1" },
      "read"
    );
    expect(mocks.audit.mock.calls[0]?.[1].metadata).toEqual({
      conversationCount: 125,
      affected: 150
    });
  });

  it.each([
    { action: "trash", filters: { folder: "inbox" } },
    { action: "read", filters: {} },
    { action: "read", filters: { folder: "inbox", cursor: "cursor" } },
    { action: "read", filters: { folder: "inbox", mailboxIds: ["forged"] } },
    { action: "read", filters: { folder: "inbox", labelUserId: "other" } },
    {
      action: "read",
      filters: { folder: "inbox", after: "2026-09-20T00:00:00Z", before: "2026-09-19T00:00:00Z" }
    }
  ])("rejects unsupported or unsafe selection scope: %j", async (body) => {
    expect((await request(body)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires authentication before changing mail", async () => {
    mocks.auth.mockRejectedValueOnce(new AppError("UNAUTHORIZED", "Sign in.", 401));
    expect((await request({ action: "read", filters: { folder: "inbox" } })).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
