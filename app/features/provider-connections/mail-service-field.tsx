import type * as React from "react";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  getMailServicePreset,
  isMailServiceId,
  type MailServiceId,
  mailServicePresets
} from "./mail-service-presets";

export function MailServiceField({
  serviceId,
  onServiceChange
}: {
  serviceId: MailServiceId;
  onServiceChange: (serviceId: MailServiceId) => void;
}): React.ReactElement {
  const preset = getMailServicePreset(serviceId);

  return (
    <Field>
      <FieldLabel htmlFor="provider-mail-service">Mail service</FieldLabel>
      <Select
        value={serviceId}
        onValueChange={(value) => {
          if (isMailServiceId(value)) onServiceChange(value);
        }}
      >
        <SelectTrigger id="provider-mail-service">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {mailServicePresets.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom or other</SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription>
        {preset ? preset.help : "Enter the secure settings from your provider."}{" "}
        {preset ? (
          <a
            className="underline underline-offset-2"
            href={preset.docsUrl}
            rel="noreferrer"
            target="_blank"
          >
            Provider setup guide
          </a>
        ) : (
          "Microsoft 365 needs OAuth, and Proton Mail needs a local Bridge; this password connection does not support them yet."
        )}
      </FieldDescription>
    </Field>
  );
}
