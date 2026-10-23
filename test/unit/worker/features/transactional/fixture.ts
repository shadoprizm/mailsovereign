import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { digest, newSecret } from "../../../../../worker/features/transactional/auth";
import type { WorkerEnv } from "../../../../../worker/lib/env";

export function migrate(sqlite: DatabaseSync, through = 24) {
  for (const file of readdirSync("migrations")
    .filter((file) => file.endsWith(".sql") && Number(file.slice(0, 4)) <= through)
    .sort())
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
}
export function d1(sqlite: DatabaseSync): D1Database {
  function prepare(sql: string, values: SQLInputValue[] = []) {
    const statement = {
      bind: (...args: SQLInputValue[]) => prepare(sql, args),
      first: async (column?: string) => {
        const row = sqlite.prepare(sql).get(...values);
        return (column ? row?.[column] : row) ?? null;
      },
      all: async () => ({ results: sqlite.prepare(sql).all(...values), success: true, meta: {} }),
      run: async () => {
        const result = sqlite.prepare(sql).run(...values);
        return { results: [], success: true, meta: { changes: Number(result.changes) } };
      }
    };
    return statement;
  }
  return {
    prepare,
    batch: async (statements: { run(): Promise<unknown> }[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  } as unknown as D1Database;
}
export async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  migrate(sqlite);
  const timestamp = new Date().toISOString();
  sqlite.exec(`INSERT INTO installation_identity VALUES (1, 'workspace-a', 'test', 'now', 'now');
    INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES ('owner', 'Owner', 'owner@login.test', 1, 'now', 'now', 'owner');
    INSERT INTO mail_domains (id, name, is_enabled, sending_status, created_at, updated_at) VALUES ('domain', 'example.com', 1, 'ready', 'now', 'now');
    INSERT INTO mailboxes VALUES ('mailbox', 'sender@example.com', 'Sender', 1, 'now', 'now');
    INSERT INTO mailbox_addresses (id, mailbox_id, mail_domain_id, local_part, address, display_name, created_at, updated_at) VALUES ('address', 'mailbox', 'domain', 'sender', 'sender@example.com', 'Sender', 'now', 'now');
    INSERT INTO provider_connections (id, provider_id, kind, display_name, mailbox_address, config_json, credential_ciphertext, credential_key_version, is_enabled, verified_at, created_at, updated_at)
      VALUES ('connection', 'smtp-test', 'imap-smtp', 'SMTP', 'sender@example.com', '{}', 'v1:aXY=:Y3Q=', 1, 1, 'now', 'now', 'now');
    INSERT INTO service_applications (id, workspace_id, name, created_by, created_at, updated_at) VALUES ('application', 'workspace-a', 'Example app', 'owner', 'now', 'now');
    INSERT INTO service_mailbox_grants VALUES ('application', 'workspace-a', 'address', 'now');`);
  const token = newSecret();
  sqlite
    .prepare(
      "INSERT INTO service_credentials (id, application_id, workspace_id, name, prefix, secret_hash, scopes_json, created_at) VALUES ('credential', 'application', 'workspace-a', 'Test key', ?, ?, '[\"transactional.send\"]', ?)"
    )
    .run(token.slice(0, 16), await digest(token), timestamp);
  const env = { DB: d1(sqlite), BETTER_AUTH_SECRET: "test-workspace-secret" } as WorkerEnv;
  const request = new Request("https://test/api/v1/transactional/send", {
    headers: { authorization: `Bearer ${token}` }
  });
  return { sqlite, env, request, token };
}
export const message = {
  from: { email: "sender@example.com", name: "Example App" },
  to: [{ email: "recipient@example.net", name: "Recipient" }],
  cc: [],
  bcc: [],
  replyTo: { email: "support@example.com", name: "Support" },
  subject: "An update",
  html: '<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>@media(max-width:600px){table{width:100%}}</style></head><body><table style="width:100%"><tr><td>Hello <a href="https://example.com">there</a></td></tr></table></body></html>',
  text: "Hello there\nhttps://example.com\n",
  headers: {
    "List-Unsubscribe": "<https://example.com/unsubscribe/token>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" as const
  }
};
