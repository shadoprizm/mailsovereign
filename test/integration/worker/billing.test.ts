import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import initialMigration from "../../../migrations/0001_initial.sql?raw";
import managedServiceMigration from "../../../migrations/0016_managed_service.sql?raw";
import aiAccessMigration from "../../../migrations/0017_ai_access.sql?raw";
import { migrationStatements } from "./migration-statements";

const origin = "https://sovereign-mail.test";
const webhookSecret = "whsec_integration_test";

describe("Sovereign AI billing webhooks", () => {
  beforeAll(async () => {
    for (const migration of [initialMigration, managedServiceMigration, aiAccessMigration]) {
      for (const statement of migrationStatements(migration)) {
        await env.DB.prepare(statement).run();
      }
    }
  });

  it("rejects an invalid signature", async () => {
    const response = await SELF.fetch(`${origin}/api/billing/webhook`, {
      body: JSON.stringify(eventFixture("evt_invalid")),
      headers: { "stripe-signature": "t=1,v1=invalid" },
      method: "POST"
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_WEBHOOK_SIGNATURE" }
    });
  });

  it("activates only this installation, grants credits, and processes retries once", async () => {
    const event = eventFixture("evt_checkout_complete");
    const payload = JSON.stringify(event);
    const signature = await stripeSignature(payload);
    const first = await SELF.fetch(`${origin}/api/billing/webhook`, {
      body: payload,
      headers: { "stripe-signature": signature },
      method: "POST"
    });
    expect(first.status, await first.clone().text()).toBe(200);
    await expect(first.json()).resolves.toEqual({ received: true, duplicate: false });

    const subscription = await env.DB.prepare(
      `SELECT stripe_customer_id, stripe_subscription_id, plan_id, status
       FROM ai_subscription WHERE singleton = 1`
    ).first<{
      stripe_customer_id: string;
      stripe_subscription_id: string;
      plan_id: string;
      status: string;
    }>();
    expect(subscription).toEqual({
      stripe_customer_id: "cus_test",
      stripe_subscription_id: "sub_test",
      plan_id: "starter",
      status: "active"
    });

    const invoice = invoiceFixture("evt_invoice_paid");
    const invoicePayload = JSON.stringify(invoice);
    const paid = await SELF.fetch(`${origin}/api/billing/webhook`, {
      body: invoicePayload,
      headers: { "stripe-signature": await stripeSignature(invoicePayload) },
      method: "POST"
    });
    expect(paid.status, await paid.clone().text()).toBe(200);
    const credits = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS balance FROM ai_credit_ledger"
    ).first<{ balance: number }>();
    expect(credits?.balance).toBe(300);

    const retry = await SELF.fetch(`${origin}/api/billing/webhook`, {
      body: payload,
      headers: { "stripe-signature": await stripeSignature(payload) },
      method: "POST"
    });
    await expect(retry.json()).resolves.toEqual({ received: true, duplicate: true });
    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM stripe_webhook_events WHERE id = ?"
    )
      .bind(event.id)
      .first<{ count: number }>();
    expect(events?.count).toBe(1);
  });
});

function eventFixture(id: string) {
  return {
    id,
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        customer: "cus_test",
        subscription: "sub_test",
        payment_status: "paid",
        metadata: {
          installation_id: "installation_test",
          plan_id: "starter",
          product: "sovereign_ai"
        }
      }
    }
  };
}

function invoiceFixture(id: string) {
  return {
    id,
    type: "invoice.paid",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        customer: "cus_test",
        subscription: "sub_test",
        lines: { data: [{ price: { id: "price_test_ai_starter" } }] }
      }
    }
  };
}

async function stripeSignature(payload: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`)
  );
  return `t=${timestamp},v1=${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
