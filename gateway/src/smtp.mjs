import smtp from "smtp-server";

export function createSmtpServer(api, tls) {
  const server = new smtp.SMTPServer({
    ...tls,
    secure: true,
    minVersion: "TLSv1.2",
    name: "Sovereign Mail",
    banner: "Sovereign Mail submission",
    logger: false,
    size: 25 * 1024 * 1024,
    authOptional: false,
    allowInsecureAuth: false,
    authMethods: ["PLAIN", "LOGIN"],
    disabledCommands: ["STARTTLS"],
    hidePIPELINING: true,
    disableReverseLookup: true,
    maxClients: 16,
    onAuth(auth, session, callback) {
      void api.authenticate(auth.username, auth.password).then(
        (result) => {
          session.nativeToken = result.token;
          session.nativeAddress = result.address;
          callback(null, { user: result.address });
        },
        () => callback(smtpError("Authentication failed.", 535))
      );
    },
    onMailFrom(address, session, callback) {
      if (!session.nativeAddress || address.address.toLowerCase() !== session.nativeAddress) {
        return callback(smtpError("Sender must match the authenticated mailbox.", 553));
      }
      void api.folders(session).then(
        () => callback(),
        () => callback(smtpError("Mailbox access unavailable.", 535))
      );
    },
    onRcptTo(_address, session, callback) {
      if (session.envelope.rcptTo.length >= 100)
        return callback(smtpError("Too many recipients.", 452));
      callback();
    },
    onData(stream, session, callback) {
      void (async () => {
        const chunks = [];
        let size = 0;
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > 25 * 1024 * 1024) continue;
          chunks.push(chunk);
        }
        if (stream.sizeExceeded || size > 25 * 1024 * 1024)
          return callback(smtpError("Message exceeds 25 MiB.", 552));
        await api.submit(
          session,
          Buffer.concat(chunks, size),
          session.envelope.mailFrom.address,
          session.envelope.rcptTo.map((recipient) => recipient.address)
        );
        callback(null, "Message accepted by Sovereign Mail.");
      })().catch(() =>
        callback(smtpError("Delivery could not be confirmed; do not resubmit automatically.", 554))
      );
    }
  });
  server.on("error", () => {});
  return server;
}

function smtpError(message, responseCode) {
  const error = new Error(message);
  error.responseCode = responseCode;
  return error;
}
