import wildduck from "@zone-eu/wildduck/imap-core/index.js";
import imapTools from "@zone-eu/wildduck/imap-core/lib/imap-tools.js";
import { installMessageHandlers } from "./imap-messages.mjs";
import { MailNotifier } from "./notifier.mjs";

// Advertise only capabilities backed by the Sovereign Mail adapter.
imapTools.sendCapabilityResponse = (connection) => {
  const authenticated = connection.state !== "Not Authenticated";
  connection.send(
    `* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR ID ENABLE UNSELECT${
      authenticated
        ? " IDLE NAMESPACE CHILDREN SPECIAL-USE UIDPLUS CONDSTORE MOVE APPENDLIMIT=26214400"
        : ""
    }`
  );
};

export function createImapServer(api, tls, options = {}) {
  const server = new wildduck.IMAPServer({
    ...tls,
    secure: true,
    minVersion: "TLSv1.2",
    disableSTARTTLS: true,
    logger: false,
    skipFetchLog: true,
    maxMessage: 25 * 1024 * 1024,
    socketTimeout: 30 * 60 * 1000,
    id: { name: "Sovereign Mail", vendor: "Sovereign Mail" }
  });
  server.server.maxConnections = 16;
  server.notifier = new MailNotifier(api, options.pollIntervalMs);
  server.on("error", () => {});
  server.onAuth = (login, session, callback) => {
    void api.authenticate(login.username, login.password).then(
      (result) => {
        session.nativeToken = result.token;
        session.nativeAddress = result.address;
        callback(null, { user: { id: session.id, username: result.address } });
      },
      () => callback(null, false)
    );
  };
  const list = async (session) =>
    (await api.folders(session)).map((folder) => ({
      ...folder,
      specialUse: { Sent: "\\Sent", Drafts: "\\Drafts", Archive: "\\Archive", Trash: "\\Trash" }[
        folder.path
      ]
    }));
  server.onList = (_query, session, callback) => {
    void list(session).then((rows) => callback(null, rows), fail(callback));
  };
  server.onLsub = (_query, session, callback) => {
    void list(session).then(
      (rows) =>
        callback(
          null,
          rows.filter((row) => row.subscribed)
        ),
      fail(callback)
    );
  };
  server.onOpen = (path, session, callback) => {
    void (async () => {
      const folder = (await api.folders(session)).find((row) => row.path === path);
      if (!folder) return callback(null, "NONEXISTENT");
      const rows = await api.entries(session, path);
      callback(null, {
        ...folder,
        _id: server.notifier.select(session, path),
        uidList: rows.map((row) => row.uid)
      });
    })().catch(fail(callback));
  };
  server.onStatus = (path, session, callback) => {
    void api.folders(session).then((rows) => {
      const folder = rows.find((row) => row.path === path);
      callback(null, folder ? { ...folder, highestModseq: folder.modifyIndex } : "NONEXISTENT");
    }, fail(callback));
  };
  for (const [handler, subscribed] of [
    ["onSubscribe", true],
    ["onUnsubscribe", false]
  ]) {
    server[handler] = (path, session, callback) => {
      void api
        .operation(session, { operation: "subscribe", path, subscribed })
        .then(() => callback(null, true), fail(callback));
    };
  }
  for (const handler of ["onCreate", "onDelete"])
    server[handler] = (_path, _session, callback) => callback(null, "CANNOT");
  server.onRename = (_path, _destination, _session, callback) => callback(null, "CANNOT");
  installMessageHandlers(server, api, wildduck.imapHandler);
  return server;
}

export function fail(callback) {
  return () => callback(new Error("Mailbox operation failed."));
}
