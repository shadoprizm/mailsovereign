export class TestBackend {
  constructor() {
    this.rows = new Map();
    this.changes = [];
    this.uid = 0;
    this.revoked = false;
    this.submissions = 0;
  }
  async authenticate(address, password) {
    if (this.revoked || address !== "owner@example.invalid" || password !== "synthetic-password")
      throw new Error("Denied");
    return { token: "synthetic-session", address };
  }
  check() {
    if (this.revoked) throw new Error("Denied");
  }
  async folders() {
    this.check();
    return ["INBOX", "Sent", "Drafts", "Archive", "Trash", "Catchall"].map((path) => {
      const rows = [...this.rows.values()].filter((row) => row.path === path);
      return {
        _id: path,
        path,
        uidValidity: 42,
        uidNext: this.uid + 1,
        modifyIndex: this.changes.filter((row) => row.path === path).at(-1)?.modseq ?? 0,
        messages: rows.length,
        unseen: rows.filter((row) => !row.flags.includes("\\Seen")).length,
        subscribed: true
      };
    });
  }
  async entries(_session, path) {
    this.check();
    return [...this.rows.values()]
      .filter((row) => row.path === path)
      .map((row) => ({
        uid: row.uid,
        flags: [...row.flags],
        modseq: row.modseq,
        idate: row.idate
      }));
  }
  async raw(_session, uid) {
    this.check();
    return this.rows.get(uid).raw;
  }
  change(path, uid, command, flags) {
    const modseq = this.changes.length + 1;
    this.changes.push({ path, uid, command, flags, modseq });
    return modseq;
  }
  async append(_session, path, flags, raw, date) {
    this.check();
    const uid = ++this.uid;
    const modseq = this.change(path, uid, "EXISTS", flags);
    this.rows.set(uid, {
      path,
      uid,
      flags: [...flags],
      raw: Buffer.from(raw),
      idate: date ?? new Date().toISOString(),
      modseq
    });
    return { uid, uidValidity: 42 };
  }
  async operation(session, input) {
    this.check();
    if (input.operation === "subscribe") return { subscribed: input.subscribed };
    const row = this.rows.get(input.uid);
    if (!row || row.path !== input.path) throw new Error("Missing");
    if (input.operation === "flags") {
      row.flags =
        input.action === "set"
          ? input.flags
          : input.action === "add"
            ? [...new Set([...row.flags, ...input.flags])]
            : row.flags.filter((flag) => !input.flags.includes(flag));
      row.modseq = this.change(row.path, row.uid, "FETCH", row.flags);
      return { flags: row.flags, modified: false };
    }
    if (input.operation === "move") {
      const destination = await this.append(
        session,
        input.destination,
        row.flags,
        row.raw,
        row.idate
      );
      this.rows.delete(row.uid);
      this.change(row.path, row.uid, "EXPUNGE");
      return { sourceUid: row.uid, destinationUid: destination.uid, uidValidity: 42 };
    }
    if (input.operation === "expunge") {
      const deleted = row.flags.includes("\\Deleted");
      if (deleted) {
        this.rows.delete(row.uid);
        this.change(row.path, row.uid, "EXPUNGE");
      }
      return { deleted };
    }
  }
  async json(path) {
    this.check();
    const url = new URL(path, "https://example.invalid");
    return this.changes.filter(
      (row) =>
        row.path === url.searchParams.get("path") &&
        row.modseq > Number(url.searchParams.get("after"))
    );
  }
  async submit() {
    this.check();
    this.submissions++;
    return { id: "synthetic-send" };
  }
}
