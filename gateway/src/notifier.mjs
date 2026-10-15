export class MailNotifier {
  constructor(api, intervalMs = 15000) {
    this.api = api;
    this.listeners = new Map();
    this.selected = new Map();
    this.interval = setInterval(() => {
      void this.poll();
    }, intervalMs);
    this.interval.unref();
    this.polling = false;
  }
  addListener(session, callback) {
    this.listeners.set(session.id, { session, callback });
  }
  removeListener(session) {
    this.listeners.delete(session.id);
    for (const [key, value] of this.selected)
      if (value.session.id === session.id) this.selected.delete(key);
  }
  select(session, path) {
    const key = `${session.id}/${path}`;
    this.selected.set(key, { session, path });
    return key;
  }
  getUpdates(key, after, callback) {
    const data = this.selected.get(key);
    if (!data) return callback(null, []);
    void this.api
      .json(
        `/journal?path=${encodeURIComponent(data.path)}&after=${after}`,
        data.session.nativeToken
      )
      .then(
        (rows) =>
          callback(
            null,
            rows.map((row) => ({ ...row, _id: String(row.modseq) }))
          ),
        () => {
          data.session.socket?.destroy();
          callback(new Error("Mailbox unavailable."));
        }
      );
  }
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const { session, callback } of this.listeners.values()) {
        try {
          await this.api.folders(session);
          callback();
        } catch {
          session.socket?.destroy();
          this.removeListener(session);
        }
      }
    } finally {
      this.polling = false;
    }
  }
  close() {
    clearInterval(this.interval);
    this.listeners.clear();
    this.selected.clear();
  }
}
