import { withProviderSyncProgress } from "@worker/features/provider-connections/progress";
import type { ImapSmtpConnectionRecord } from "@worker/providers/connections";
import { providerId } from "@worker/providers/types";
import { describe, expect, it } from "vitest";

const connection: ImapSmtpConnectionRecord = {
  id: "conn-1",
  providerId: providerId("google-personal"),
  kind: "imap-smtp",
  displayName: "Personal Gmail",
  mailboxAddress: "owner@example.com",
  config: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    tls: "required",
    importSince: "2026-08-01"
  },
  credentialKeyVersion: 1,
  isEnabled: true,
  verifiedAt: null,
  lastSyncedAt: null,
  lastErrorCode: null,
  createdAt: "2026-09-10T12:00:00.000Z",
  updatedAt: "2026-09-10T12:00:00.000Z"
};

function database(cursor: { last_seen_uid: number; backfill_before_uid: number | null } | null) {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            first: async () => {
              if (sql.includes("provider_sync_state")) return cursor;
              if (sql.includes("source_provider_connection_id")) return { count: 24 };
              if (sql.includes("provider_sync_quarantine")) return { count: 1 };
              return null;
            }
          };
        }
      };
    }
  } as unknown as D1Database;
}

describe("provider backfill progress", () => {
  it("reports imported and quarantined counts with an explicit UID estimate", async () => {
    const [result] = await withProviderSyncProgress(
      database({ last_seen_uid: 100, backfill_before_uid: 76 }),
      [connection]
    );
    expect(result?.syncProgress).toEqual({
      phase: "backfilling",
      importedMessages: 24,
      quarantinedMessages: 1,
      estimatedPercent: 25,
      estimatedRemainingUidPositions: 75
    });
  });

  it("distinguishes a not-started import from a current Inbox", async () => {
    const [notStarted] = await withProviderSyncProgress(database(null), [connection]);
    expect(notStarted?.syncProgress.phase).toBe("not_started");

    const [current] = await withProviderSyncProgress(
      database({ last_seen_uid: 100, backfill_before_uid: null }),
      [connection]
    );
    expect(current?.syncProgress).toMatchObject({ phase: "current", estimatedPercent: 100 });
  });
});
