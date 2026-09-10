export type ProfessionalSignatureDesign = {
  accentColor: string;
  brand: string;
  brandBackgroundColor: string;
  cardBackgroundColor: string;
  email: string;
  fullName: string;
  jobTitle: string;
  parentOrganization: string;
  phone: string;
  tagline: string;
  website: string;
};

const professionalCardMarker = "professional-card-v1";
const designKeys: (keyof ProfessionalSignatureDesign)[] = [
  "accentColor",
  "brand",
  "brandBackgroundColor",
  "cardBackgroundColor",
  "email",
  "fullName",
  "jobTitle",
  "parentOrganization",
  "phone",
  "tagline",
  "website"
];

export function defaultProfessionalSignatureDesign(): ProfessionalSignatureDesign {
  return {
    accentColor: "#2563eb",
    brand: "",
    brandBackgroundColor: "#0f172a",
    cardBackgroundColor: "#f8fafc",
    email: "",
    fullName: "",
    jobTitle: "",
    parentOrganization: "",
    phone: "",
    tagline: "",
    website: ""
  };
}

export function buildProfessionalSignature(design: ProfessionalSignatureDesign): {
  html: string;
  text: string;
} {
  const normalized = normalizeDesign(design);
  const metadata = escapeAttribute(encodeURIComponent(JSON.stringify(normalized)));
  const accent = normalized.accentColor;
  const brandBackground = normalized.brandBackgroundColor;
  const cardBackground = normalized.cardBackgroundColor;
  const contactRows = [
    contactRow("M", normalized.phone, phoneHref(normalized.phone), accent),
    contactRow("E", normalized.email, emailHref(normalized.email), accent),
    contactRow("W", normalized.website, websiteHref(normalized.website), accent)
  ].join("");
  const parentOrganization = normalized.parentOrganization
    ? `<div style="border-top:1px solid #64748b;margin-top:10px;padding-top:8px"><div style="color:#cbd5e1;font-size:7px;font-weight:700;letter-spacing:1px;line-height:1.25;text-transform:uppercase">A division of</div><div style="color:#ffffff;font-size:8px;font-weight:700;letter-spacing:0.8px;line-height:1.35;text-transform:uppercase">${escapeText(normalized.parentOrganization)}</div></div>`
    : "";
  const tagline = normalized.tagline
    ? `<div style="color:#bfdbfe;font-size:8px;font-weight:700;letter-spacing:0.7px;line-height:1.35;margin-top:4px;text-transform:uppercase">${escapeText(normalized.tagline)}</div>`
    : "";
  const jobTitle = normalized.jobTitle
    ? `<div style="color:#475569;font-size:11px;line-height:1.35;margin-top:3px">${escapeText(normalized.jobTitle)}</div>`
    : "";

  return {
    html: `<table data-signature-design="${metadata}" data-sovereign-signature="${professionalCardMarker}" border="0" cellpadding="0" cellspacing="0" width="520" style="border:1px solid #dbe3ec;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;max-width:520px;width:100%"><tbody><tr><td bgcolor="${brandBackground}" valign="middle" width="43%" style="background-color:${brandBackground};border-left:4px solid ${accent};padding:18px 16px;vertical-align:middle;width:43%"><div style="color:#ffffff;font-size:21px;font-weight:700;letter-spacing:2px;line-height:1.05;text-transform:uppercase">${escapeText(normalized.brand)}</div>${tagline}${parentOrganization}</td><td bgcolor="${cardBackground}" valign="middle" width="57%" style="background-color:${cardBackground};padding:18px 16px;vertical-align:middle;width:57%"><div style="color:#0f172a;font-size:16px;font-weight:700;line-height:1.25">${escapeText(normalized.fullName)}</div>${jobTitle}${contactRows ? `<div style="margin-top:8px">${contactRows}</div>` : ""}</td></tr></tbody></table>`,
    text: professionalSignatureText(normalized)
  };
}

export function professionalSignatureDesignFromHtml(
  html: string
): ProfessionalSignatureDesign | null {
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const card = document.body.querySelector(
    `[data-sovereign-signature="${professionalCardMarker}"]`
  );
  const encoded = card?.getAttribute("data-signature-design");
  if (!encoded) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as unknown;
    if (!isRecord(parsed)) return null;
    const design = defaultProfessionalSignatureDesign();
    for (const key of designKeys) {
      if (typeof parsed[key] === "string") design[key] = parsed[key];
    }
    return normalizeDesign(design);
  } catch {
    return null;
  }
}

function normalizeDesign(design: ProfessionalSignatureDesign): ProfessionalSignatureDesign {
  return {
    accentColor: safeColor(design.accentColor, "#2563eb"),
    brand: design.brand.trim(),
    brandBackgroundColor: safeColor(design.brandBackgroundColor, "#0f172a"),
    cardBackgroundColor: safeColor(design.cardBackgroundColor, "#f8fafc"),
    email: design.email.trim(),
    fullName: design.fullName.trim(),
    jobTitle: design.jobTitle.trim(),
    parentOrganization: design.parentOrganization.trim(),
    phone: design.phone.trim(),
    tagline: design.tagline.trim(),
    website: design.website.trim()
  };
}

function professionalSignatureText(design: ProfessionalSignatureDesign): string {
  return [
    design.fullName,
    design.jobTitle,
    design.brand,
    design.tagline,
    design.parentOrganization ? `A division of ${design.parentOrganization}` : "",
    design.phone,
    design.email,
    design.website
  ]
    .filter(Boolean)
    .join("\n");
}

function contactRow(label: string, value: string, href: string | null, accent: string): string {
  if (!value) return "";
  const text = escapeText(value);
  const content = href
    ? `<a href="${escapeAttribute(href)}" style="color:#334155;text-decoration:none">${text}</a>`
    : text;
  return `<div style="color:#334155;font-size:10px;line-height:1.55"><span style="color:${accent};display:inline-block;font-size:9px;font-weight:700;width:18px">${label}</span><span>${content}</span></div>`;
}

function phoneHref(phone: string): string | null {
  const value = phone.replace(/(?!^)\+|[^\d+]/g, "");
  return value ? `tel:${value}` : null;
}

function emailHref(email: string): string | null {
  return email && !/[\s\r\n]/.test(email) ? `mailto:${email}` : null;
}

function websiteHref(website: string): string | null {
  if (!website) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function safeColor(value: string, fallback: string): string {
  return /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeText(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
