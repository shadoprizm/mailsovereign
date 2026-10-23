import MailComposer from "nodemailer/lib/mail-composer/index.js";

export class BackendError extends Error {
  constructor(status) {
    super("Sovereign Mail request failed.");
    this.status = status;
  }
}

export class MailApi {
  constructor(origin, fetcher = fetch) {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error("A plain HTTPS Sovereign Mail origin is required.");
    }
    this.origin = url.origin;
    this.fetcher = fetcher;
  }

  async request(path, token, options = {}) {
    const response = await this.fetcher(`${this.origin}/api/native-mail${path}`, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers }
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new BackendError(response.status);
    }
    return response;
  }

  async json(path, token, options) {
    return (await this.request(path, token, options)).json();
  }
  async authenticate(address, password) {
    return this.json("/authenticate", null, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, password })
    });
  }
  async folders(session) {
    return this.json("/folders", session.nativeToken);
  }
  async entries(session, path) {
    const rows = [];
    let after = 0;
    while (true) {
      const page = await this.json(
        `/entries?path=${encodeURIComponent(path)}&after=${after}`,
        session.nativeToken
      );
      if (!page.length) break;
      if (page.at(-1).uid <= after || rows.length + page.length > 100000)
        throw new Error("Mailbox listing limit reached.");
      rows.push(...page);
      after = page.at(-1).uid;
      if (page.length < 500) break;
    }
    return rows;
  }
  async raw(session, uid) {
    const response = await this.request(`/raw/${uid}`, session.nativeToken);
    if (response.headers.get("content-type")?.includes("application/json")) {
      const message = await response.json();
      // Fixed boundaries make reconstructed source stable across FETCH calls and restarts.
      message.baseBoundary = `sovereign-${uid}`;
      message.boundaryPrefix = "sovereign";
      const raw = await new MailComposer(message).compile().build();
      if (raw.length > 25 * 1024 * 1024)
        throw new Error("Message source exceeds the gateway limit.");
      return raw;
    }
    const parts = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) throw new Error("Message source exceeds the gateway limit.");
      parts.push(chunk);
    }
    return Buffer.concat(parts, size);
  }
  async operation(session, input) {
    return this.json("/operation", session.nativeToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  }
  async append(session, path, flags, raw, date, forceCopy = false) {
    return this.json("/append", session.nativeToken, {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "message/rfc822",
        "x-native-message": JSON.stringify({
          path,
          flags,
          ...(date ? { date: new Date(date).toISOString() } : {}),
          forceCopy
        })
      }
    });
  }
  async submit(session, raw, from, recipients) {
    return this.json("/submit", session.nativeToken, {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "message/rfc822",
        "x-native-envelope": JSON.stringify({ from, recipients })
      }
    });
  }
}
