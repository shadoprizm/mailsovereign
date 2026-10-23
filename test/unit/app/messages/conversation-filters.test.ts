import { describe, expect, it } from "vitest";

import {
  activeConversationFilterCount,
  conversationFilterApiParams,
  conversationFilterDateError,
  createEmptyConversationFilters,
  normalizeConversationFilters,
  recentConversationDateRange
} from "@/features/messages/conversation-filters";

describe("conversation filters", () => {
  it("normalizes text and counts every active structured criterion", () => {
    const filters = {
      ...createEmptyConversationFilters(),
      attachments: "with" as const,
      contains: "  launch plan  ",
      from: "  client@example.com ",
      read: "unread" as const
    };

    expect(normalizeConversationFilters(filters)).toMatchObject({
      contains: "launch plan",
      from: "client@example.com"
    });
    expect(activeConversationFilterCount(filters, "label-priority")).toBe(5);
  });

  it("turns inclusive local dates into safe API boundaries", () => {
    const filters = {
      ...createEmptyConversationFilters(),
      after: "2026-09-10",
      before: "2026-09-13",
      direction: "inbound" as const,
      exclude: " newsletter ",
      starred: "unstarred" as const
    };

    expect(conversationFilterApiParams(filters)).toEqual({
      after: new Date(2026, 8, 10).toISOString(),
      before: new Date(2026, 8, 14).toISOString(),
      direction: "inbound",
      exclude: "newsletter",
      starred: "unstarred"
    });
  });

  it("validates inverted ranges and builds deterministic recent presets", () => {
    expect(
      conversationFilterDateError({
        ...createEmptyConversationFilters(),
        after: "2026-09-14",
        before: "2026-09-13"
      })
    ).toBe("The end date must be the same as or later than the start date.");
    expect(recentConversationDateRange(7, new Date(2026, 8, 13, 15, 30))).toEqual({
      after: "2026-09-07",
      before: "2026-09-13"
    });
  });
});
