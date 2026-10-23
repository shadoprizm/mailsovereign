import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateService } from "../../../../../worker/features/transactional/auth";
import { sendTransactional } from "../../../../../worker/features/transactional/service";
import { ProviderError } from "../../../../../worker/providers/errors";
import { fixture, message } from "./fixture";

afterEach(() => vi.useRealTimers());
describe("transactional submission", () => {
  it("preserves content and headers, stores no mail content, and replays after seven days and key rotation", async () => {
    const f = await fixture();
    const principal = await authenticateService(f.env, f.request);
    const submit = vi.fn().mockResolvedValue({ providerMessageId: "provider-id" });
    const result = await sendTransactional(f.env, f.request, principal, message, "key1", submit);
    expect(result).toMatchObject({ status: "accepted", id: expect.stringMatching(/^msg_/) });
    expect(submit).toHaveBeenCalledWith(
      f.env,
      expect.objectContaining({
        html: message.html,
        text: message.text,
        headers: message.headers,
        replyTo: message.replyTo,
        recipientNames: { "recipient@example.net": "Recipient" },
        messageId: `<${result.id}@example.com>`
      }),
      { expectedConnectionId: "connection" }
    );
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 8 * 86400000);
    expect(await sendTransactional(f.env, f.request, principal, message, "key1", submit)).toEqual(
      result
    );
    expect(submit).toHaveBeenCalledTimes(1);
    const ledger = JSON.stringify(f.sqlite.prepare("SELECT * FROM transactional_sends").all());
    for (const sensitive of [
      f.token,
      message.html,
      message.text,
      "recipient@example.net",
      "provider-id",
      "key1"
    ])
      expect(ledger).not.toContain(sensitive);
    expect(
      f.sqlite.prepare("SELECT minute_count, day_count FROM service_applications").get()
    ).toEqual({ minute_count: 1, day_count: 1 });
  });
  it("rejects conflicts and only submits once under concurrency", async () => {
    const f = await fixture();
    const principal = await authenticateService(f.env, f.request);
    const submit = vi.fn().mockResolvedValue({ providerMessageId: "id" });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        sendTransactional(f.env, f.request, principal, message, "same", submit)
      )
    );
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    await expect(
      sendTransactional(
        f.env,
        f.request,
        principal,
        { ...message, subject: "Changed" },
        "same",
        submit
      )
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each([
    ["DELETE FROM service_mailbox_grants", 403],
    ["UPDATE mailboxes SET is_active = 0", 422],
    ["UPDATE mailbox_addresses SET send_enabled = 0", 422],
    ["UPDATE mail_domains SET is_enabled = 0", 422],
    ["UPDATE provider_connections SET is_enabled = 0", 422],
    ["UPDATE provider_connections SET verified_at = NULL", 422],
    ["UPDATE provider_connections SET last_error_code = 'PROVIDER_AUTH_FAILED'", 422],
    ["DELETE FROM provider_connections", 422]
  ])("checks live sender restrictions: %s", async (sql, status) => {
    const f = await fixture();
    const principal = await authenticateService(f.env, f.request);
    const submit = vi.fn().mockResolvedValue({ providerMessageId: "id" });
    await sendTransactional(f.env, f.request, principal, message, "before", submit);
    f.sqlite.exec(sql);
    await expect(
      sendTransactional(f.env, f.request, principal, message, "before", submit)
    ).rejects.toMatchObject({ status });
    await expect(
      sendTransactional(f.env, f.request, principal, message, "after", submit)
    ).rejects.toMatchObject({ status });
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it.each([
    "per_minute",
    "per_day"
  ])("enforces atomic %s limits without charging replay", async (column) => {
    const f = await fixture();
    f.sqlite.exec(`UPDATE service_applications SET ${column} = 1`);
    const principal = await authenticateService(f.env, f.request);
    const submit = vi.fn().mockResolvedValue({ providerMessageId: "id" });
    await sendTransactional(f.env, f.request, principal, message, "first", submit);
    await sendTransactional(f.env, f.request, principal, message, "first", submit);
    await expect(
      sendTransactional(f.env, f.request, principal, message, "second", submit)
    ).rejects.toMatchObject({ status: 429 });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(f.sqlite.prepare("SELECT count(*) n FROM transactional_sends").get()).toEqual({ n: 1 });
  });
  it("retries only a definitely unaccepted temporary failure with the same internal ID", async () => {
    const f = await fixture();
    const principal = await authenticateService(f.env, f.request);
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError("PROVIDER_UNAVAILABLE", "smtp", true))
      .mockResolvedValue({ providerMessageId: "id" });
    await expect(
      sendTransactional(f.env, f.request, principal, message, "retry", submit)
    ).rejects.toMatchObject({ code: "PROVIDER_TEMPORARY", status: 503 });
    const row = f.sqlite.prepare("SELECT id FROM transactional_sends").get();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31000);
    expect(await sendTransactional(f.env, f.request, principal, message, "retry", submit)).toEqual({
      id: row?.id,
      status: "accepted"
    });
    expect(submit).toHaveBeenCalledTimes(2);
  });
  it.each([
    [new ProviderError("PROVIDER_SEND_REJECTED", "smtp", true), "failed", 422],
    [new ProviderError("PROVIDER_UNAVAILABLE", "smtp"), "uncertain", 503],
    [new Error("untrusted mail and secret details"), "uncertain", 503]
  ])("retains permanent or uncertain results without resending", async (error, state, status) => {
    const f = await fixture();
    const principal = await authenticateService(f.env, f.request);
    const submit = vi.fn().mockRejectedValue(error);
    for (let i = 0; i < 2; i++)
      await expect(
        sendTransactional(f.env, f.request, principal, message, "failed", submit)
      ).rejects.toMatchObject({ status });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(f.sqlite.prepare("SELECT status FROM transactional_sends").get()).toEqual({
      status: state
    });
  });
});

it("never resubmits after provider acceptance followed by ledger persistence failure", async () => {
  const f = await fixture();
  const principal = await authenticateService(f.env, f.request);
  f.sqlite.exec(
    "CREATE TRIGGER fail_accept BEFORE UPDATE OF status ON transactional_sends WHEN NEW.status = 'accepted' BEGIN SELECT RAISE(ABORT, 'simulated persistence failure'); END;"
  );
  const submit = vi.fn().mockResolvedValue({ providerMessageId: "accepted" });
  await expect(
    sendTransactional(f.env, f.request, principal, message, "crash", submit)
  ).rejects.toThrow();
  f.sqlite.exec("DROP TRIGGER fail_accept");
  await expect(
    sendTransactional(f.env, f.request, principal, message, "crash", submit)
  ).rejects.toMatchObject({ code: "SEND_IN_PROGRESS", status: 503 });
  expect(submit).toHaveBeenCalledTimes(1);
});
it("rechecks credential revocation at the submission boundary", async () => {
  const f = await fixture();
  const principal = await authenticateService(f.env, f.request);
  f.sqlite.exec(
    "CREATE TRIGGER revoke_at_reservation AFTER INSERT ON transactional_sends BEGIN UPDATE service_credentials SET revoked_at = 'now'; END;"
  );
  const submit = vi.fn();
  await expect(
    sendTransactional(f.env, f.request, principal, message, "revoked", submit)
  ).rejects.toMatchObject({ status: 401 });
  expect(submit).not.toHaveBeenCalled();
});
it("preserves idempotency across session-secret rotation", async () => {
  const f = await fixture();
  const principal = await authenticateService(f.env, f.request);
  const submit = vi.fn().mockResolvedValue({ providerMessageId: "accepted" });
  const original = await sendTransactional(f.env, f.request, principal, message, "stable", submit);
  const rotatedEnv = { ...f.env, BETTER_AUTH_SECRET: "new-session-signing-secret" };
  expect(
    await sendTransactional(rotatedEnv, f.request, principal, message, "stable", submit)
  ).toEqual(original);
  expect(submit).toHaveBeenCalledTimes(1);
});
