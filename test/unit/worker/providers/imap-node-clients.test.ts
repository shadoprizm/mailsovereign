import { ProviderCredentials } from "@worker/providers/credentials";
import { createImapFlowClient } from "@worker/providers/imap/node-imap-client";
import { createNodemailerSmtpClient } from "@worker/providers/imap/node-smtp-client";
import { ImapClientError } from "@worker/providers/imap/ports";
import type { SmtpSubmitError } from "@worker/providers/imap/transport";
import { describe, expect, it, vi } from "vitest";

const config = {
  imapHost: "imap.mxrouting.net",
  imapPort: 993,
  smtpHost: "smtp.mxrouting.net",
  smtpPort: 465,
  tls: "required" as const
};
const credentials = new ProviderCredentials("ops@example.com", "hunter2-secret");

function imapRuntime(overrides: Record<string, unknown> = {}) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    list: vi.fn().mockResolvedValue([
      { path: "INBOX", specialUse: "\\Inbox" },
      { path: "Sent", specialUse: "\\Sent" }
    ]),
    status: vi.fn().mockResolvedValue({ path: "INBOX", uidValidity: 7n, uidNext: 10 }),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    fetch: vi.fn(() =>
      (async function* () {
        yield {
          uid: 8,
          flags: new Set(["\\Seen"]),
          envelope: { messageId: "<m@example.com>", from: [{ address: "sender@example.com" }] }
        };
      })()
    ),
    fetchOne: vi.fn().mockResolvedValue({
      uid: 8,
      size: 4,
      source: new Uint8Array([1, 2, 3, 4])
    }),
    ...overrides
  };
}

describe("ImapFlow client adapter", () => {
  it("uses required TLS, disables protocol logging, and bounds parser memory", async () => {
    const runtime = imapRuntime();
    const createRuntime = vi.fn(() => runtime);
    const client = createImapFlowClient(config, credentials, createRuntime as never);

    await client.listFolders({ maxFolders: 8 });

    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        host: config.imapHost,
        port: config.imapPort,
        secure: true,
        logger: false,
        logRaw: false,
        emitLogs: false,
        maxLiteralSize: expect.any(Number),
        maxResponseSize: expect.any(Number)
      })
    );
    expect(runtime.connect).toHaveBeenCalledOnce();
  });

  it("maps folders and enforces the caller's folder cap", async () => {
    const runtime = imapRuntime();
    const client = createImapFlowClient(config, credentials, (() => runtime) as never);

    await expect(client.listFolders({ maxFolders: 8 })).resolves.toEqual([
      { path: "INBOX", specialUse: "inbox" },
      { path: "Sent", specialUse: "sent" }
    ]);
    await expect(client.listFolders({ maxFolders: 1 })).rejects.toBeInstanceOf(ImapClientError);
  });

  it("fetches only a bounded UID range and releases the mailbox lock", async () => {
    const release = vi.fn();
    const runtime = imapRuntime({
      getMailboxLock: vi.fn().mockResolvedValue({ release })
    });
    const client = createImapFlowClient(config, credentials, (() => runtime) as never);

    await expect(
      client.listUids("INBOX", { fromUid: 8, toUid: 9, maxEntries: 2 })
    ).resolves.toEqual([
      {
        uid: 8,
        seen: true,
        messageIdHeader: "<m@example.com>",
        senderAddress: "sender@example.com"
      }
    ]);
    expect(runtime.fetch).toHaveBeenCalledWith(
      "8:9",
      { envelope: true, flags: true, uid: true },
      { uid: true }
    );
    expect(release).toHaveBeenCalledOnce();
    await expect(
      client.listUids("INBOX", { fromUid: 1, toUid: 3, maxEntries: 2 })
    ).rejects.toBeInstanceOf(ImapClientError);
  });

  it("refuses oversized raw messages before returning partial content", async () => {
    const runtime = imapRuntime({
      fetchOne: vi.fn().mockResolvedValue({ uid: 8, size: 11, source: new Uint8Array(9) })
    });
    const client = createImapFlowClient(config, credentials, (() => runtime) as never);

    await expect(client.fetchRaw("INBOX", 8, { maxBytes: 10 })).rejects.toMatchObject({
      reason: "message_too_large"
    });
  });

  it("closes without exposing provider error detail", async () => {
    const runtime = imapRuntime({
      connect: vi.fn().mockRejectedValue(new Error("LOGIN password=hunter2-secret"))
    });
    const client = createImapFlowClient(config, credentials, (() => runtime) as never);

    try {
      await client.listFolders({ maxFolders: 8 });
      expect.unreachable();
    } catch (error) {
      const clientError = error as ImapClientError;
      expect(clientError.message).not.toContain("hunter2-secret");
      expect(clientError.stack).not.toContain("hunter2-secret");
    }
    await client.close();
    expect(runtime.close).toHaveBeenCalledOnce();
  });
});

describe("Nodemailer SMTP client adapter", () => {
  it("maps the transport contract with file and URL loading disabled", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "<sent@example.com>", rejected: [] });
    const close = vi.fn();
    const createTransport = vi.fn(() => ({ sendMail, verify: vi.fn(), close }));
    const client = createNodemailerSmtpClient(config, credentials, createTransport as never);

    const result = await client.submit({
      from: { name: "Ops", email: "ops@example.com" },
      to: ["owner@example.com"],
      subject: "Hello",
      text: "Body",
      attachments: [
        {
          filename: "note.txt",
          contentType: "text/plain",
          content: new TextEncoder().encode("hello"),
          disposition: "attachment"
        }
      ]
    });

    expect(result).toEqual({ messageId: "<sent@example.com>" });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: true,
        requireTLS: true,
        logger: false,
        debug: false,
        auth: { user: "ops@example.com", pass: "hunter2-secret" }
      })
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: "Ops", address: "ops@example.com" },
        disableFileAccess: true,
        disableUrlAccess: true
      })
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("verifies SMTP authentication without sending a message", async () => {
    const sendMail = vi.fn();
    const verify = vi.fn().mockResolvedValue(true);
    const close = vi.fn();
    const client = createNodemailerSmtpClient(
      config,
      credentials,
      vi.fn(() => ({ sendMail, verify, close })) as never
    );

    await expect(client.verify()).resolves.toBeUndefined();
    expect(verify).toHaveBeenCalledOnce();
    expect(sendMail).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("classifies failures without carrying Nodemailer detail across the port", async () => {
    const cases = [
      [{ code: "EAUTH", message: "password=hunter2-secret" }, "auth"],
      [{ code: "ETIMEDOUT", message: "password=hunter2-secret" }, "timeout"],
      [{ responseCode: 450, message: "password=hunter2-secret" }, "rate_limited"],
      [{ code: "ECONNECTION", message: "password=hunter2-secret" }, "unavailable"],
      [{ responseCode: 550, message: "password=hunter2-secret" }, "rejected"]
    ] as const;

    for (const [failure, reason] of cases) {
      const createTransport = vi.fn(() => ({
        sendMail: vi.fn().mockRejectedValue(failure),
        verify: vi.fn(),
        close: vi.fn()
      }));
      const client = createNodemailerSmtpClient(config, credentials, createTransport as never);
      try {
        await client.submit({
          from: "ops@example.com",
          to: "owner@example.com",
          subject: "Hello",
          text: "Body"
        });
        expect.unreachable();
      } catch (error) {
        const submitError = error as SmtpSubmitError;
        expect(submitError.reason).toBe(reason);
        expect(submitError.message).not.toContain("hunter2-secret");
        expect(submitError.stack).not.toContain("hunter2-secret");
      }
    }
  });
});
