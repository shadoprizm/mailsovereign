import { fail } from "./imap.mjs";

export function installMessageHandlers(server, api, compiler) {
  server.onAppend = (path, flags, date, raw, session, callback) => {
    void api
      .append(session, path, flags, raw, date)
      .then((info) => callback(null, true, info), fail(callback));
  };
  server.onStore = (_mailbox, update, session, callback) => {
    void (async () => {
      const modified = [];
      for (const uid of update.messages) {
        const result = await api.operation(session, {
          operation: "flags",
          path: session.selected.path,
          uid,
          action: update.action,
          flags: update.value,
          ...(update.unchangedSince ? { unchangedSince: update.unchangedSince } : {})
        });
        if (result.modified) {
          modified.push(uid);
          continue;
        }
        if (!update.silent || session.selected.condstoreEnabled) {
          const current = (await api.entries(session, session.selected.path)).find(
            (row) => row.uid === uid
          );
          if (current)
            await writeResponse(
              session,
              session.formatResponse("FETCH", uid, {
                uid: update.isUid ? uid : false,
                flags: update.silent ? false : current.flags,
                modseq: session.selected.condstoreEnabled ? current.modseq : false
              }),
              compiler
            );
        }
      }
      callback(null, true, modified);
    })().catch(fail(callback));
  };
  server.onFetch = (_mailbox, options, session, callback) => {
    void (async () => {
      const rows = await api.entries(session, session.selected.path);
      for (const row of rows) {
        if (
          !options.messages.includes(row.uid) ||
          (options.changedSince && row.modseq <= options.changedSince)
        )
          continue;
        if (options.markAsSeen && !session.selected.readOnly && !row.flags.includes("\\Seen")) {
          const changed = await api.operation(session, {
            operation: "flags",
            path: session.selected.path,
            uid: row.uid,
            action: "add",
            flags: ["\\Seen"]
          });
          if (changed.modified) throw new Error("Message changed; retry FETCH.");
          row.flags = changed.flags;
          row.modseq = changed.modseq ?? row.modseq;
        }
        if (!options.metadataOnly) row.raw = await api.raw(session, row.uid);
        row.idate = new Date(row.idate);
        await writeResponse(
          session,
          session.formatResponse("FETCH", row.uid, {
            query: options.query,
            values: session.getQueryResponse(options.query, row)
          }),
          compiler
        );
      }
      callback(null, true);
    })().catch(fail(callback));
  };
  server.onSearch = (_mailbox, options, session, callback) => {
    void (async () => {
      const rows = await api.entries(session, session.selected.path);
      const uidList = [];
      let highestModseq = 0;
      for (const row of rows) {
        row.idate = new Date(row.idate);
        row.raw = await api.raw(session, row.uid);
        const matches = await new Promise((resolve, reject) => {
          session.matchSearchQuery(row, options.query, (error, result) =>
            error ? reject(error) : resolve(result)
          );
        });
        if (matches) {
          uidList.push(row.uid);
          highestModseq = Math.max(highestModseq, row.modseq);
        }
      }
      callback(null, { uidList, highestModseq });
    })().catch(fail(callback));
  };
  server.onExpunge = (_mailbox, update, session, callback) => {
    void (async () => {
      const rows = await api.entries(session, session.selected.path);
      for (const row of rows) {
        if (
          !row.flags.includes("\\Deleted") ||
          (update.isUid && !update.messages.includes(row.uid))
        )
          continue;
        const result = await api.operation(session, {
          operation: "expunge",
          path: session.selected.path,
          uid: row.uid
        });
        if (result.deleted && !update.silent)
          await writeResponse(session, session.formatResponse("EXPUNGE", row.uid), compiler);
      }
      callback(null, true);
    })().catch(fail(callback));
  };
  server.onCopy = (_connection, _mailbox, update, session, callback) => {
    void (async () => {
      const rows = await api.entries(session, session.selected.path);
      const sourceUid = [],
        destinationUid = [];
      let uidValidity;
      for (const row of rows) {
        if (!update.messages.includes(row.uid)) continue;
        const result = await api.append(
          session,
          update.destination,
          row.flags,
          await api.raw(session, row.uid),
          row.idate,
          true
        );
        sourceUid.push(row.uid);
        destinationUid.push(result.uid);
        uidValidity = result.uidValidity;
      }
      callback(null, true, { uidValidity, sourceUid, destinationUid });
    })().catch(fail(callback));
  };
  server.onMove = (_mailbox, update, session, callback) => {
    void (async () => {
      const sourceUid = [],
        destinationUid = [];
      let uidValidity;
      for (const uid of update.messages) {
        const result = await api.operation(session, {
          operation: "move",
          path: session.selected.path,
          uid,
          destination: update.destination
        });
        sourceUid.push(uid);
        destinationUid.push(result.destinationUid);
        uidValidity = result.uidValidity;
        await writeResponse(session, session.formatResponse("EXPUNGE", uid), compiler);
      }
      callback(null, true, { uidValidity, sourceUid, destinationUid });
    })().catch(fail(callback));
  };
}

function writeResponse(session, response, compiler) {
  return new Promise((resolve, reject) =>
    session.writeStream.write(compiler.compileStream(response), (error) =>
      error ? reject(error) : resolve()
    )
  );
}
