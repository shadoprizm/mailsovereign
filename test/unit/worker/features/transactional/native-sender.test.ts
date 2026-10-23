import { describe, expect, it, vi } from "vitest";
import { authenticateService } from "../../../../../worker/features/transactional/auth";
import { sendTransactional } from "../../../../../worker/features/transactional/service";
import { getMailTransportForAddress } from "../../../../../worker/providers/resolver";
import { fixture, message } from "./fixture";

const verifiedDomain = `UPDATE mail_domains SET kind = 'managed', sending_status = 'ready',
  dns_status = 'ready', verified_at = 'now', zone_id = 'zone', account_id = 'account'`;
async function nativeFixture() {
  const f = await fixture();
  f.sqlite.exec(`DELETE FROM provider_connections; ${verifiedDomain}`);
  const send = vi.fn().mockResolvedValue({ messageId: "native-provider-id" });
  f.env.MAIL_SENDER = { send } as unknown as SendEmail;
  return { ...f, send, principal: await authenticateService(f.env, f.request) };
}

describe("verified native transactional senders", () => {
  it("preserves the complete message through the shared Cloudflare transport and submits once", async () => {
    const f = await nativeFixture();
    const result = await sendTransactional(f.env, f.request, f.principal, message, "native");
    expect(await sendTransactional(f.env, f.request, f.principal, message, "native")).toEqual(
      result
    );
    expect(f.send).toHaveBeenCalledExactlyOnceWith({
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers
    });
    expect(f.sqlite.prepare("SELECT status, attempt_count FROM transactional_sends").get()).toEqual(
      {
        status: "accepted",
        attempt_count: 1
      }
    );
  });
  it.each([
    "kind = 'external'",
    "sending_status = 'pending'",
    "dns_status = 'degraded'",
    "verified_at = NULL",
    "zone_id = NULL",
    "account_id = NULL",
    "is_enabled = 0",
    "last_error_code = 'DOMAIN_UNAVAILABLE'"
  ])("rejects unready native domains: %s", async (change) => {
    const f = await nativeFixture();
    f.sqlite.exec(`UPDATE mail_domains SET ${change}`);
    await expect(
      sendTransactional(f.env, f.request, f.principal, message, "unready")
    ).rejects.toMatchObject({ code: "MAILBOX_UNAVAILABLE" });
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each([
    "is_enabled = 0",
    "verified_at = NULL",
    "last_error_code = 'PROVIDER_AUTH_FAILED'"
  ])("never falls back from an unhealthy SMTP connection: %s", async (change) => {
    const f = await fixture();
    f.sqlite.exec(`${verifiedDomain}; UPDATE provider_connections SET ${change}`);
    const send = vi.fn();
    f.env.MAIL_SENDER = { send } as unknown as SendEmail;
    await expect(
      sendTransactional(
        f.env,
        f.request,
        await authenticateService(f.env, f.request),
        message,
        "smtp-owned"
      )
    ).rejects.toMatchObject({ code: "MAILBOX_UNAVAILABLE" });
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects a deleted SMTP connection instead of resolving a new native route", async () => {
    const f = await nativeFixture();
    await expect(
      getMailTransportForAddress(f.env, message.from.email, undefined, false, "deleted-connection")
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", definitelyNotAccepted: true });
    expect(f.send).not.toHaveBeenCalled();
  });
  it("rechecks domain readiness at the final submission boundary", async () => {
    const f = await nativeFixture();
    const batch = f.env.DB.batch.bind(f.env.DB);
    f.env.DB.batch = async (statements) => {
      f.sqlite.exec("UPDATE mail_domains SET sending_status = 'disabled'");
      return batch(statements);
    };
    await expect(
      sendTransactional(f.env, f.request, f.principal, message, "changed")
    ).rejects.toMatchObject({ code: "PROVIDER_TEMPORARY" });
    expect(f.send).not.toHaveBeenCalled();
  });
});
