import * as React from "react";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ProfessionalSignatureDesign } from "./professional-signature";

export function ProfessionalSignatureEditor({
  design,
  onChange
}: {
  design: ProfessionalSignatureDesign;
  onChange: (design: ProfessionalSignatureDesign) => void;
}): React.ReactElement {
  const id = React.useId();
  const update = (key: keyof ProfessionalSignatureDesign, value: string): void => {
    onChange({ ...design, [key]: value });
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium">Professional card design</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Build an email-safe two-panel signature. Empty optional details are left out.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-full-name`}>Full name</FieldLabel>
          <Input
            autoComplete="name"
            id={`${id}-full-name`}
            maxLength={100}
            required
            value={design.fullName}
            onChange={(event) => update("fullName", event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-job-title`}>Job title</FieldLabel>
          <Input
            autoComplete="organization-title"
            id={`${id}-job-title`}
            maxLength={120}
            placeholder="Owner · Software Developer"
            value={design.jobTitle}
            onChange={(event) => update("jobTitle", event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-brand`}>Brand</FieldLabel>
          <Input
            autoComplete="organization"
            id={`${id}-brand`}
            maxLength={80}
            placeholder="ASTRA"
            required
            value={design.brand}
            onChange={(event) => update("brand", event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-tagline`}>Brand descriptor</FieldLabel>
          <Input
            id={`${id}-tagline`}
            maxLength={140}
            placeholder="Software Development & Digital Systems"
            value={design.tagline}
            onChange={(event) => update("tagline", event.target.value)}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={`${id}-parent-organization`}>Parent organization</FieldLabel>
          <Input
            id={`${id}-parent-organization`}
            maxLength={100}
            placeholder="North Star Holdings"
            value={design.parentOrganization}
            onChange={(event) => update("parentOrganization", event.target.value)}
          />
          <FieldDescription>
            Shown as “A division of” beneath the brand descriptor.
          </FieldDescription>
        </Field>
      </div>

      <div className="grid gap-4 border-t pt-5 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={`${id}-phone`}>Phone</FieldLabel>
          <Input
            autoComplete="tel"
            id={`${id}-phone`}
            maxLength={40}
            placeholder="613 555 0123"
            type="tel"
            value={design.phone}
            onChange={(event) => update("phone", event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
          <Input
            autoComplete="email"
            id={`${id}-email`}
            maxLength={254}
            placeholder="you@example.com"
            type="email"
            value={design.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-website`}>Website</FieldLabel>
          <Input
            autoComplete="url"
            id={`${id}-website`}
            maxLength={300}
            placeholder="example.com"
            value={design.website}
            onChange={(event) => update("website", event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 border-t pt-5 sm:grid-cols-3">
        <ColorField
          id={`${id}-brand-background`}
          label="Brand panel"
          value={design.brandBackgroundColor}
          onChange={(value) => update("brandBackgroundColor", value)}
        />
        <ColorField
          id={`${id}-card-background`}
          label="Contact panel"
          value={design.cardBackgroundColor}
          onChange={(value) => update("cardBackgroundColor", value)}
        />
        <ColorField
          id={`${id}-accent`}
          label="Accent"
          value={design.accentColor}
          onChange={(value) => update("accentColor", value)}
        />
      </div>

      <Field>
        <FieldLabel>Live preview</FieldLabel>
        <ProfessionalSignaturePreview design={design} />
        <FieldDescription>
          The sent signature uses inline styles and no externally loaded images.
        </FieldDescription>
      </Field>
    </div>
  );
}

function ProfessionalSignaturePreview({
  design
}: {
  design: ProfessionalSignatureDesign;
}): React.ReactElement {
  const contacts = [
    { label: "M", value: design.phone },
    { label: "E", value: design.email },
    { label: "W", value: design.website }
  ].filter((contact) => contact.value.trim());

  return (
    <div className="overflow-x-auto rounded-md border bg-white p-4">
      <span className="sr-only">Professional signature preview</span>
      <table
        className="w-full max-w-[520px] border-collapse border border-[#dbe3ec] font-sans"
        role="presentation"
      >
        <tbody>
          <tr>
            <td
              className="w-[43%] px-4 py-[18px] align-middle"
              style={{
                backgroundColor: design.brandBackgroundColor,
                borderLeft: `4px solid ${design.accentColor}`
              }}
            >
              <div className="text-[21px] font-bold uppercase leading-none tracking-[2px] text-white">
                {design.brand || "Your brand"}
              </div>
              {design.tagline ? (
                <div className="mt-1 text-[8px] font-bold uppercase leading-snug tracking-[0.7px] text-blue-200">
                  {design.tagline}
                </div>
              ) : null}
              {design.parentOrganization ? (
                <div className="mt-2.5 border-t border-slate-500 pt-2">
                  <div className="text-[7px] font-bold uppercase leading-tight tracking-[1px] text-slate-300">
                    A division of
                  </div>
                  <div className="text-[8px] font-bold uppercase leading-snug tracking-[0.8px] text-white">
                    {design.parentOrganization}
                  </div>
                </div>
              ) : null}
            </td>
            <td
              className="w-[57%] px-4 py-[18px] align-middle"
              style={{ backgroundColor: design.cardBackgroundColor }}
            >
              <div className="text-base font-bold leading-tight text-slate-900">
                {design.fullName || "Your name"}
              </div>
              {design.jobTitle ? (
                <div className="mt-1 text-[11px] leading-snug text-slate-600">
                  {design.jobTitle}
                </div>
              ) : null}
              {contacts.length ? (
                <div className="mt-2">
                  {contacts.map((contact) => (
                    <div className="text-[10px] leading-relaxed text-slate-700" key={contact.label}>
                      <span
                        className="inline-block w-[18px] text-[9px] font-bold"
                        style={{ color: design.accentColor }}
                      >
                        {contact.label}
                      </span>
                      <span>{contact.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ColorField({
  id,
  label,
  onChange,
  value
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}): React.ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          aria-label={`${label} color`}
          className="w-12 shrink-0 cursor-pointer p-1"
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="font-mono text-xs uppercase text-muted-foreground">{value}</span>
      </div>
    </Field>
  );
}
