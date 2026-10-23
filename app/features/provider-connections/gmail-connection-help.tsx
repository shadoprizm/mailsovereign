import type * as React from "react";

export function GmailConnectionHelp({ email }: { email: string }): React.ReactElement {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-4 text-sm">
      <p className="font-medium">Connect Gmail with a Google app password</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          In Google, select <strong>{email || "the same account as your mailbox email"}</strong>.
          Enable 2-Step Verification if needed.
        </li>
        <li>
          <a
            className="underline underline-offset-2"
            href="https://myaccount.google.com/apppasswords"
            rel="noreferrer"
            target="_blank"
          >
            Open Google App passwords
          </a>{" "}
          and create one named Sovereign Mail.
        </li>
        <li>Paste the app password below, then verify the connection in Sovereign Mail.</li>
      </ol>
      <p className="text-xs text-muted-foreground">
        Your normal Google password will not work. App passwords belong to one Google account; one
        from another Gmail account will not work here. Enter the password only in this form.
      </p>
      <a
        className="text-xs underline underline-offset-2"
        href="https://support.google.com/accounts/answer/185833"
        rel="noreferrer"
        target="_blank"
      >
        Google help: app passwords and availability
      </a>
    </div>
  );
}

export function usesGmailServers(config: { imapHost: string; smtpHost: string }): boolean {
  return (
    config.imapHost.toLowerCase() === "imap.gmail.com" &&
    config.smtpHost.toLowerCase() === "smtp.gmail.com"
  );
}
