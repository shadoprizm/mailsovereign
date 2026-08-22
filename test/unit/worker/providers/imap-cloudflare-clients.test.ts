import { ProviderCredentials } from "@worker/providers/credentials";
import { createCloudflareImapClient } from "@worker/providers/imap/cloudflare-imap-client";
import { createCloudflareSmtpClient } from "@worker/providers/imap/cloudflare-smtp-client";
import { ImapClientError } from "@worker/providers/imap/ports";
import type { SmtpSubmitError } from "@worker/providers/imap/transport";
import { CFImap, ImapError, type Options } from "cf-imap";
import { describe, expect, it, vi } from "vitest";
import { Email, type WorkerMailerOptions } from "worker-mailer";

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
    close: vi.fn().mockResolvedValue(true),
    examine: vi.fn().mockResolvedValue({ uidValidity: 7, uidNext: 10 }),
    getFolders: vi.fn().mockResolvedValue([
      { name: "INBOX", delimiter: "/", attributes: ["\\Inbox"] },
      { name: "Sent", delimiter: "/", attributes: ["\\Sent"] }
    ]),
    status: vi.fn().mockResolvedValue({ uidvalidity: 7, uidnext: 10 }),
    fetchRawMessage: vi.fn().mockResolvedValue({
      uid: 8,
      size: 4,
      raw: new TextEncoder().encode("test")
    }),
    fetchEmails: vi.fn().mockImplementation(({ fetchBody }: { fetchBody: boolean }) =>
      Promise.resolve([
        {
          uid: 8,
          seq: 1,
          flags: ["Seen"],
          internalDate: new Date("2026-08-18T00:00:00.000Z"),
          size: 4,
          from: ["Sender <sender@example.com>"],
          to: ["ops@example.com"],
          cc: [],
          subject: "Hello",
          messageID: "<m@example.com>",
          contentType: "text/plain",
          headers: { "message-id": "<m@example.com>" },
          rawHeaders: "Message-ID: <m@example.com>",
          body: { raw: fetchBody ? "test" : "" },
          attachments: [],
          raw: fetchBody ? "test" : "Message-ID: <m@example.com>"
        }
      ])
    ),
    ...overrides
  };
}

describe("Cloudflare-native IMAP client adapter", () => {
  it("preserves a raw message when Dovecot reports metadata after the literal", async () => {
    const runtime = new CFImap({
      host: config.imapHost,
      port: config.imapPort,
      tls: true,
      auth: { username: "ops@example.com", password: "hunter2-secret" }
    });
    const internals = runtime as unknown as Record<string, unknown>;
    internals.socket = {};
    internals.selectedFolder = "INBOX";
    internals.writer = { write: vi.fn().mockResolvedValue(undefined) };
    internals.stream = {
      readUntilTag: vi.fn().mockResolvedValue({
        items: [
          {
            line: "* 1 FETCH (UID 8 RFC822.SIZE 4 BODY[]<0> {4}",
            literal: new Uint8Array([0, 127, 128, 255])
          },
          { line: ")", literal: null }
        ]
      })
    };

    await expect(runtime.fetchRawMessage({ uid: 8, byteLimit: 5 })).resolves.toEqual({
      uid: 8,
      size: 4,
      raw: new Uint8Array([0, 127, 128, 255])
    });
  });

  it("uses the Worker-native client with required TLS and bounded response time", async () => {
    const runtime = imapRuntime();
    const createRuntime = vi.fn((_options: Options) => runtime);
    const client = createCloudflareImapClient(config, credentials, createRuntime as never);

    await client.listFolders({ maxFolders: 8 });

    expect(createRuntime).toHaveBeenCalledWith({
      host: config.imapHost,
      port: config.imapPort,
      tls: true,
      auth: { username: "ops@example.com", password: "hunter2-secret" },
      timeoutMs: 30_000
    });
    expect(runtime.connect).toHaveBeenCalledOnce();
  });

  it("maps folders and enforces the caller's folder cap", async () => {
    const runtime = imapRuntime();
    const client = createCloudflareImapClient(config, credentials, (() => runtime) as never);

    await expect(client.listFolders({ maxFolders: 8 })).resolves.toEqual([
      { path: "INBOX", specialUse: "inbox" },
      { path: "Sent", specialUse: "sent" }
    ]);
    await expect(client.listFolders({ maxFolders: 1 })).rejects.toBeInstanceOf(ImapClientError);
  });

  it("fetches a bounded UID range from a read-only mailbox", async () => {
    const runtime = imapRuntime();
    const client = createCloudflareImapClient(config, credentials, (() => runtime) as never);

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
    expect(runtime.examine).toHaveBeenCalledWith("INBOX");
    expect(runtime.fetchEmails).toHaveBeenCalledWith({
      limit: [8, 9],
      fetchBody: false,
      peek: true,
      useUid: true
    });
    await expect(
      client.listUids("INBOX", { fromUid: 1, toUid: 3, maxEntries: 2 })
    ).rejects.toBeInstanceOf(ImapClientError);
  });

  it("maps the native client's lowercase mailbox status fields", async () => {
    const runtime = imapRuntime();
    const client = createCloudflareImapClient(config, credentials, (() => runtime) as never);

    await expect(client.folderStatus("INBOX")).resolves.toEqual({
      path: "INBOX",
      uidValidity: 7,
      uidNext: 10
    });
  });

  it("refuses oversized raw messages before returning partial content", async () => {
    const runtime = imapRuntime({
      fetchRawMessage: vi.fn().mockResolvedValue({
        uid: 8,
        size: 11,
        raw: new TextEncoder().encode("12345678901")
      })
    });
    const client = createCloudflareImapClient(config, credentials, (() => runtime) as never);

    await expect(client.fetchRaw("INBOX", 8, { maxBytes: 10 })).rejects.toMatchObject({
      reason: "message_too_large"
    });
    expect(runtime.fetchRawMessage).toHaveBeenCalledWith({ uid: 8, byteLimit: 11 });
  });

  it("returns raw message bytes without UTF-8 conversion", async () => {
    const raw = new Uint8Array([0, 127, 128, 255]);
    const runtime = imapRuntime({
      fetchRawMessage: vi.fn().mockResolvedValue({ uid: 8, size: raw.byteLength, raw })
    });
    const client = createCloudflareImapClient(config, credentials, (() => runtime) as never);

    const result = await client.fetchRaw("INBOX", 8, { maxBytes: 10 });

    expect([...new Uint8Array(result)]).toEqual([...raw]);
  });

  it("classifies rejected authentication without exposing provider detail", async () => {
    const runtime = imapRuntime({
      connect: vi
        .fn()
        .mockRejectedValue(new ImapError("NO", "A1", "LOGIN password=hunter2-secret", []))
    });
    const client = createCloudflareImapClient(config, credentials, (() => runtime) as never);

    try {
      await client.listFolders({ maxFolders: 8 });
      expect.unreachable();
    } catch (error) {
      const clientError = error as ImapClientError;
      expect(clientError.reason).toBe("auth");
      expect(clientError.message).not.toContain("hunter2-secret");
      expect(clientError.stack).not.toContain("hunter2-secret");
    }
    await client.close();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("closes the native client once after use", async () => {
    const runtime = imapRuntime();
    const client = createCloudflareImapClient(config, credentials, (() => runtime) as never);
    await client.listFolders({ maxFolders: 8 });
    await client.close();
    await client.close();
    expect(runtime.close).toHaveBeenCalledOnce();
  });
});

function smtpRuntime(overrides: Record<string, unknown> = {}) {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe("Cloudflare-native SMTP client adapter", () => {
  it("uses a native implicit-TLS connection for port 465 verification", async () => {
    const runtime = smtpRuntime();
    const connectRuntime = vi.fn((_options: WorkerMailerOptions) => Promise.resolve(runtime));
    const client = createCloudflareSmtpClient(config, credentials, connectRuntime);

    await expect(client.verify()).resolves.toBeUndefined();
    expect(connectRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: true,
        startTls: false,
        credentials: { username: "ops@example.com", password: "hunter2-secret" }
      })
    );
    expect(runtime.send).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("submits recipients and bounded attachments through the native runtime", async () => {
    const runtime = smtpRuntime();
    const client = createCloudflareSmtpClient(
      config,
      credentials,
      vi.fn().mockResolvedValue(runtime)
    );

    const result = await client.submit({
      from: { name: "Ops", email: "ops@example.com" },
      to: ["owner@example.com"],
      bcc: "private@example.com",
      subject: "Hello",
      text: "Body",
      headers: { Bcc: "must-not-leak@example.com", "X-Test": "safe" },
      attachments: [
        {
          filename: "hello.txt",
          contentType: "text/plain",
          content: "hello",
          disposition: "attachment"
        }
      ]
    });

    expect(result.messageId).toMatch(/^<.+@example\.com>$/);
    expect(runtime.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: "Ops", email: "ops@example.com" },
        bcc: "private@example.com",
        headers: { "X-Test": "safe", "Message-ID": result.messageId },
        attachments: [{ filename: "hello.txt", mimeType: "text/plain", content: "aGVsbG8=" }]
      })
    );
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("uses the Worker-native STARTTLS client for submission ports", async () => {
    const startTlsConfig = { ...config, smtpPort: 587 };
    const runtime = {
      send: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const connectRuntime = vi.fn().mockResolvedValue(runtime);
    const client = createCloudflareSmtpClient(startTlsConfig, credentials, connectRuntime);

    await expect(client.verify()).resolves.toBeUndefined();
    expect(connectRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        host: config.smtpHost,
        port: 587,
        secure: false,
        startTls: true,
        credentials: { username: "ops@example.com", password: "hunter2-secret" }
      })
    );
    expect(runtime.send).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("fails closed for inline attachments that the runtime cannot represent safely", async () => {
    const client = createCloudflareSmtpClient(config, credentials, vi.fn() as never);
    await expect(
      client.submit({
        from: "ops@example.com",
        to: "owner@example.com",
        subject: "Hello",
        text: "Body",
        attachments: [
          {
            filename: "pixel.png",
            contentType: "image/png",
            content: "image",
            disposition: "inline",
            contentId: "pixel"
          }
        ]
      })
    ).rejects.toMatchObject({ reason: "rejected" });
  });

  it("keeps BCC recipients in the SMTP envelope but out of generated message headers", () => {
    const message = new Email({
      from: "ops@example.com",
      to: "owner@example.com",
      bcc: "private@example.com",
      subject: "Hello",
      text: "Body"
    }).getEmailData();

    expect(message).not.toMatch(/^BCC:/im);
    expect(message).not.toContain("private@example.com");
  });

  it("classifies failures without carrying provider detail across the port", async () => {
    const cases = [
      [{ code: "EAUTH", message: "password=hunter2-secret" }, "auth"],
      [{ code: "ETIMEDOUT", message: "password=hunter2-secret" }, "timeout"],
      [{ responseCode: 450, message: "password=hunter2-secret" }, "rate_limited"],
      [{ code: "ECONNECTION", message: "password=hunter2-secret" }, "unavailable"],
      [{ responseCode: 550, message: "password=hunter2-secret" }, "rejected"]
    ] as const;

    for (const [failure, reason] of cases) {
      const runtime = smtpRuntime({ send: vi.fn().mockRejectedValue(failure) });
      const client = createCloudflareSmtpClient(
        config,
        credentials,
        vi.fn().mockResolvedValue(runtime)
      );
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
