export const mailServicePresets = [
  {
    id: "mxroute",
    label: "MXroute",
    imapHost: null,
    imapPort: "993",
    smtpHost: null,
    smtpPort: "465",
    sharedHost: true,
    help: "Enter the server hostname assigned to your account in the MXroute panel.",
    passwordHelp: "Use the password for this mailbox, not your MXroute account password.",
    docsUrl: "https://mxroutedocs.com/general/smtpimappopdetails/"
  },
  {
    id: "google",
    label: "Gmail or Google Workspace",
    imapHost: "imap.gmail.com",
    imapPort: "993",
    smtpHost: "smtp.gmail.com",
    smtpPort: "465",
    sharedHost: false,
    help: "Google's secure IMAP and SMTP settings are filled in.",
    passwordHelp: "Use a Google app password. Your normal Google password is not accepted here.",
    docsUrl: "https://support.google.com/mail/answer/7126229"
  },
  {
    id: "icloud",
    label: "Apple iCloud Mail",
    imapHost: "imap.mail.me.com",
    imapPort: "993",
    smtpHost: "smtp.mail.me.com",
    smtpPort: "587",
    sharedHost: false,
    help: "Apple's secure iCloud Mail settings are filled in.",
    passwordHelp: "Use an Apple app-specific password and your full iCloud Mail address.",
    docsUrl: "https://support.apple.com/102525"
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    imapHost: "imap.mail.yahoo.com",
    imapPort: "993",
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: "465",
    sharedHost: false,
    help: "Yahoo's secure IMAP and SMTP settings are filled in.",
    passwordHelp: "Generate and use a Yahoo app password.",
    docsUrl: "https://help.yahoo.com/kb/imap-internet-message-access-protocol-sln4075.html"
  },
  {
    id: "fastmail",
    label: "Fastmail",
    imapHost: "imap.fastmail.com",
    imapPort: "993",
    smtpHost: "smtp.fastmail.com",
    smtpPort: "465",
    sharedHost: false,
    help: "Fastmail's secure IMAP and SMTP settings are filled in.",
    passwordHelp:
      "Use a Fastmail app password with Mail access. Basic plans do not include IMAP or SMTP.",
    docsUrl: "https://www.fastmail.help/hc/en-us/articles/1500000278342"
  },
  {
    id: "zoho-organization",
    label: "Zoho Mail — organization",
    imapHost: "imappro.zoho.com",
    imapPort: "993",
    smtpHost: "smtppro.zoho.com",
    smtpPort: "465",
    sharedHost: false,
    help: "For a paid Zoho organization using a custom email domain. Regional accounts may use different hosts.",
    passwordHelp: "Use a Zoho app password when two-factor authentication is enabled.",
    docsUrl: "https://www.zoho.com/mail/help/imap-access.html"
  },
  {
    id: "zoho-personal",
    label: "Zoho Mail — personal",
    imapHost: "imap.zoho.com",
    imapPort: "993",
    smtpHost: "smtp.zoho.com",
    smtpPort: "465",
    sharedHost: false,
    help: "For a personal Zoho Mail address. Regional accounts may use different hosts.",
    passwordHelp: "Use a Zoho app password when two-factor authentication is enabled.",
    docsUrl: "https://www.zoho.com/mail/help/imap-access.html"
  },
  {
    id: "namecheap-private-email",
    label: "Namecheap Private Email",
    imapHost: "mail.privateemail.com",
    imapPort: "993",
    smtpHost: "mail.privateemail.com",
    smtpPort: "465",
    sharedHost: true,
    help: "Namecheap Private Email's secure server settings are filled in.",
    passwordHelp: "Use the password for this Private Email mailbox.",
    docsUrl:
      "https://www.namecheap.com/support/knowledgebase/article.aspx/9142/2186/general-configuration-for-mail-clients-and-mobile-devices/"
  },
  {
    id: "aol",
    label: "AOL Mail",
    imapHost: "imap.aol.com",
    imapPort: "993",
    smtpHost: "smtp.aol.com",
    smtpPort: "465",
    sharedHost: false,
    help: "AOL's secure IMAP and SMTP settings are filled in.",
    passwordHelp: "Use an AOL app password when your account requires one.",
    docsUrl:
      "https://help.aol.com/articles/how-do-i-use-other-email-applications-to-send-and-receive-my-aol-mail"
  }
] as const;

export type MailServiceId = "custom" | (typeof mailServicePresets)[number]["id"];
export type MailServicePreset = (typeof mailServicePresets)[number];

export type MailServerFields = {
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
};

const presetIds = new Set<string>(mailServicePresets.map((preset) => preset.id));

export function isMailServiceId(value: string): value is MailServiceId {
  return value === "custom" || presetIds.has(value);
}

export function getMailServicePreset(id: MailServiceId): MailServicePreset | null {
  return mailServicePresets.find((preset) => preset.id === id) ?? null;
}

export function applyMailServicePreset(
  current: MailServerFields,
  preset: MailServicePreset
): MailServerFields {
  return {
    imapHost: preset.imapHost ?? current.imapHost,
    imapPort: preset.imapPort,
    smtpHost: preset.smtpHost ?? current.smtpHost,
    smtpPort: preset.smtpPort
  };
}

export function detectMailService(email: string): MailServiceId | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  if (domain === "gmail.com" || domain === "googlemail.com") return "google";
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") return "icloud";
  if (
    domain === "yahoo.com" ||
    domain === "ymail.com" ||
    domain === "rocketmail.com" ||
    domain.startsWith("yahoo.")
  ) {
    return "yahoo";
  }
  if (domain === "fastmail.com" || domain === "fastmail.fm") return "fastmail";
  if (domain === "zoho.com" || domain === "zohomail.com") return "zoho-personal";
  if (domain === "aol.com") return "aol";
  return null;
}

export function connectionIdSuggestion(serviceId: MailServiceId, email: string): string {
  const localPart = email.trim().toLowerCase().split("@")[0] ?? "";
  const servicePart = serviceId === "custom" ? "mail" : serviceId.replace("-organization", "");
  const normalizedLocalPart = localPart
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${servicePart}-${normalizedLocalPart || "primary"}`.slice(0, 64);
}
