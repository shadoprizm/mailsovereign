import { env, SELF } from "cloudflare:test";
import { hashPassword } from "better-auth/crypto";
import { beforeAll, describe, expect, it } from "vitest";

import initialMigration from "../../../migrations/0001_initial.sql?raw";
import workspaceMigration from "../../../migrations/0002_workspace.sql?raw";
import oauthResourcesMigration from "../../../migrations/0003_oauth_resources.sql?raw";
import conversationMigration from "../../../migrations/0004_conversations.sql?raw";
import threadRebuildMigration from "../../../migrations/0005_rebuild_threads.sql?raw";
import pushMigration from "../../../migrations/0006_push_notifications.sql?raw";
import userMailPreferencesMigration from "../../../migrations/0007_user_mail_preferences.sql?raw";
import userOnboardingMigration from "../../../migrations/0008_user_onboarding.sql?raw";
import loginEmailDomainMigration from "../../../migrations/0009_login_email_domain_isolation.sql?raw";
import domainMigrationPreflight from "../../../migrations/0010_domain_migration_preflight.sql?raw";
import providerConnectionsMigration from "../../../migrations/0011_provider_connections.sql?raw";
import providerSyncStateMigration from "../../../migrations/0012_provider_sync_state.sql?raw";
import providerSyncBackfillMigration from "../../../migrations/0013_provider_sync_backfill.sql?raw";
import providerDeliveryRoutingMigration from "../../../migrations/0014_provider_delivery_routing.sql?raw";
import emailSignaturesMigration from "../../../migrations/0015_email_signatures.sql?raw";
import managedServiceMigration from "../../../migrations/0016_managed_service.sql?raw";
import aiAccessMigration from "../../../migrations/0017_ai_access.sql?raw";
import contactsMigration from "../../../migrations/0018_contacts.sql?raw";
import aiWritingProfilesMigration from "../../../migrations/0019_ai_writing_profiles.sql?raw";
import sovereignProductIdentityMigration from "../../../migrations/0020_sovereign_product_identity.sql?raw";
import { buildSeedSql } from "../../../scripts/local-seed-fixture.mjs";
import resetSql from "../../../scripts/sovereign-mail/reset-d1.sql?raw";
import { migrationStatements } from "./migration-statements";

const origin = "https://sovereign-mail.test";
const migrations = [
  initialMigration,
  workspaceMigration,
  oauthResourcesMigration,
  conversationMigration,
  threadRebuildMigration,
  pushMigration,
  userMailPreferencesMigration,
  userOnboardingMigration,
  loginEmailDomainMigration,
  domainMigrationPreflight,
  providerConnectionsMigration,
  providerSyncStateMigration,
  providerSyncBackfillMigration,
  providerDeliveryRoutingMigration,
  emailSignaturesMigration,
  managedServiceMigration,
  aiAccessMigration,
  contactsMigration,
  aiWritingProfilesMigration,
  sovereignProductIdentityMigration
];

describe("local database reset", () => {
  beforeAll(async () => {
    await applyMigrations();
    await applyStatements(
      buildSeedSql(await hashPassword("local-seed-password"), new Date("2026-08-14T18:00:00.000Z"))
    );
  });

  it("removes current data and supports a fresh migration", async () => {
    await applyStatements(resetSql);
    await applyMigrations();

    const setup = await SELF.fetch(`${origin}/api/setup/status`);
    await expect(setup.json()).resolves.toMatchObject({
      isComplete: false,
      userCount: 0,
      mailboxCount: 0
    });

    const oauthTables = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('oauthResource', 'oauthClientResource', 'oauthClientAssertion', 'user_onboarding')`
    ).first<{ count: number }>();
    expect(oauthTables?.count).toBe(4);
    const providerColumns = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pragma_table_info('provider_connections')
       WHERE name IN ('mailbox_address', 'verified_at', 'last_synced_at', 'last_error_code')`
    ).first<{ count: number }>();
    expect(providerColumns?.count).toBe(4);
    const signatureTables = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name IN ('email_signatures', 'email_signature_defaults')`
    ).first<{ count: number }>();
    expect(signatureTables?.count).toBe(2);
    const billingTables = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('ai_subscription', 'ai_credit_ledger', 'ai_usage_events', 'stripe_webhook_events')`
    ).first<{ count: number }>();
    expect(billingTables?.count).toBe(4);
    const contactTables = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name IN ('contacts', 'contact_emails', 'contact_recents')`
    ).first<{ count: number }>();
    expect(contactTables?.count).toBe(3);
    const writingProfileTables = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name = 'ai_writing_profiles'`
    ).first<{ count: number }>();
    expect(writingProfileTables?.count).toBe(1);
    const productIdentity = await env.DB.prepare(
      "SELECT value FROM sovereign_mail_schema_state WHERE key = 'product'"
    ).first<{ value: string }>();
    expect(productIdentity?.value).toBe("sovereign-mail");
    const releaseIdentity = await env.DB.prepare(
      "SELECT product, installed_schema_version FROM release_state WHERE singleton = 1"
    ).first<{ product: string; installed_schema_version: number }>();
    expect(releaseIdentity).toEqual({
      product: "sovereign-mail",
      installed_schema_version: 20
    });
  });
});

async function applyMigrations(): Promise<void> {
  for (const migration of migrations) {
    await applyStatements(migration);
  }
}

async function applyStatements(source: string): Promise<void> {
  for (const statement of migrationStatements(source)) {
    await env.DB.prepare(statement).run();
  }
}
