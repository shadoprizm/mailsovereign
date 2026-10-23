import type { Page } from "@playwright/test";

const timestamp = "2026-10-18T12:00:00.000Z";
export const user = {
  id: "mobile-owner",
  name: "Mobile Owner",
  email: "owner@example.test",
  role: "owner",
  defaultFromMailboxId: "mailbox-1",
  passwordSetupRequired: false
};
const mailbox = {
  id: "mailbox-1",
  address: "hello@example.test",
  addresses: [],
  displayName: "Team",
  isActive: true,
  accessLevel: "manager",
  createdAt: timestamp,
  updatedAt: timestamp
};
export const messages = Array.from({ length: 40 }, (_, index) => ({
  id: `message-${index}`,
  threadId: `thread-${index}`,
  mailboxId: mailbox.id,
  direction: "inbound",
  folder: "inbox",
  fromAddress: "sender-with-a-long-address@example.test",
  to: [mailbox.address],
  subject: `Mobile conversation ${index}`,
  snippet: "A readable message preview for mobile.",
  textBody: "Hello from a synthetic mobile test.\nThis message contains no customer data.",
  readAt: index === 0 ? null : timestamp,
  starredAt: null,
  isStarred: false,
  unreadCount: index === 0 ? 1 : 0,
  messageCount: 1,
  hasAttachments: false,
  receivedAt: timestamp,
  sentAt: null,
  createdAt: timestamp,
  cc: [],
  bcc: [],
  deliveredToAddress: mailbox.address,
  htmlAvailable: false,
  messageId: null,
  inReplyTo: null,
  references: [],
  attachments: []
}));

export async function mockWorkspace(
  page: Page,
  role = "owner"
): Promise<{ actions: string[]; saves: Record<string, unknown>[]; failSaves: boolean }> {
  const storedMessages = messages.map((message) => ({ ...message }));
  const state = {
    actions: [] as string[],
    saves: [] as Record<string, unknown>[],
    failSaves: false
  };
  let draft = {
    id: "draft-mobile",
    mailboxId: mailbox.id,
    replyToMessageId: null,
    forwardOfMessageId: null,
    signatureMode: "none",
    signatureId: null,
    from: mailbox.address,
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    text: "",
    html: "<p></p>",
    version: 1,
    updatedAt: timestamp,
    attachments: []
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (pathname === "/api/setup/status")
      return json({
        isComplete: true,
        primaryDomain: "example.test",
        portalHostname: "mail.example.test",
        domains: [{ id: "domain-1", name: "example.test", isEnabled: true }],
        userCount: 1,
        mailboxCount: 1,
        checklistAcknowledged: true
      });
    if (pathname === "/api/me") return json({ ...user, role });
    if (pathname === "/api/mailboxes") return json([mailbox]);
    if (pathname === "/api/users")
      return json([
        {
          ...user,
          role,
          banned: false,
          createdAt: timestamp,
          onboardingMethod: null,
          invitationSentAt: null
        }
      ]);
    if (pathname === "/api/notifications/status")
      return json({
        latestInboundMessageId: "message-0",
        unread: { total: 1, inbox: 1, catchall: 0, inboxByMailbox: { [mailbox.id]: 1 } },
        vapidPublicKey: null
      });
    if (pathname === "/api/conversations") {
      const search = url.searchParams.get("search") ?? "";
      const conversations = storedMessages.filter(
        (message) =>
          message.folder === (url.searchParams.get("folder") ?? "inbox") &&
          message.subject.includes(search)
      );
      return json({ conversations, totalCount: conversations.length, nextCursor: null });
    }
    if (/\/api\/messages\/message-\d+\/thread$/.test(pathname))
      return json([storedMessages[Number(pathname.split("/")[3]?.split("-")[1])]]);
    if (/\/api\/conversations\/message-\d+\//.test(pathname)) {
      state.actions.push(pathname);
      const message = storedMessages[Number(pathname.split("/")[3]?.split("-")[1])];
      const action = pathname.split("/")[4];
      if (message && action === "archive") message.folder = "archived";
      if (message && (action === "read" || action === "unread")) {
        message.unreadCount = action === "read" ? 0 : 1;
        message.readAt = action === "read" ? timestamp : null;
      }
      return json({ affected: 1, threadId: `thread-${pathname.split("/")[3]?.split("-")[1]}` });
    }
    if (pathname === "/api/contacts") return json({ contacts: [], nextCursor: null });
    if (pathname === "/api/signatures") return json({ signatures: [], defaults: {} });
    if (pathname === "/api/drafts" && request.method() === "GET") return json([]);
    if (pathname === "/api/drafts" && request.method() === "POST") {
      draft = { ...draft, ...request.postDataJSON() };
      return json(draft);
    }
    if (pathname === "/api/drafts/draft-mobile" && request.method() === "PATCH") {
      const save = request.postDataJSON();
      state.saves.push(save);
      if (state.failSaves)
        return json({ error: { code: "test-outage", message: "Draft save failed." } }, 503);
      draft = {
        ...draft,
        ...save,
        version: draft.version + 1,
        updatedAt: new Date().toISOString()
      };
      return json(draft);
    }
    if (pathname === "/api/domains")
      return json([
        {
          id: "domain-1",
          name: "a-very-long-business-domain.example.test",
          kind: "managed",
          receivingStatus: "ready",
          sendingStatus: "ready",
          dnsStatus: "ready",
          catchAllPolicy: "reject",
          catchAllMailboxId: null,
          canRemove: false,
          isEnabled: true,
          updatedAt: timestamp
        }
      ]);
    if (pathname === "/api/updates")
      return json({
        product: "sovereign-mail",
        runningVersion: "1.2.1",
        installedVersion: "1.2.1",
        installedSchemaVersion: 26,
        channel: "stable",
        available: false,
        compatible: true,
        checkedAt: timestamp,
        compatibilityIssue: null,
        release: {
          version: "1.2.1",
          schemaVersion: 26,
          publishedAt: timestamp,
          notesUrl: "https://example.test/releases"
        }
      });
    if (pathname === "/api/billing")
      return json({
        configured: false,
        aiAvailable: false,
        aiAccessActive: false,
        planId: "starter",
        status: "none",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        creditBalance: 0,
        monthlyCreditAllowance: 0,
        canOpenPortal: false,
        plans: [],
        coreProductAvailable: true
      });
    if (pathname === "/api/ai/writing-profile") return json({ markdown: "", updatedAt: null });
    if (pathname === "/api/ai/provider") return json({ configured: false, provider: null });
    if (pathname === "/api/operations/diagnostics") return json(null);
    return json([]);
  });
  return state;
}
