import * as React from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { RecipientInput } from "@/features/contacts/recipient-input";
import {
  parseSignatureChoice,
  signatureChoiceValue
} from "@/features/signatures/signature-content";
import type { EmailSignature, SignatureChoice } from "@/features/signatures/types";
import type { ComposeMode } from "./compose-state";

export type SendingIdentity = { mailboxId: string; address: string };
export function ComposeFields(props: {
  identities: SendingIdentity[];
  mode: ComposeMode;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  signatures: EmailSignature[];
  signatureChoice: SignatureChoice;
  defaultSignatureName: string | null;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  setCc: (value: string) => void;
  setBcc: (value: string) => void;
  setSubject: (value: string) => void;
  setSignatureChoice: (value: SignatureChoice) => void;
}) {
  const recipientHintId = React.useId();

  return (
    <div className="flex flex-col px-5">
      <Row label="From">
        <Select required value={props.from} onValueChange={props.setFrom}>
          <SelectTrigger
            aria-label="From"
            className="h-10 rounded-none border-0 bg-transparent px-0 shadow-none focus:ring-0"
          >
            <SelectValue placeholder="Choose address" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {props.identities.map((identity) => (
                <SelectItem key={identity.address} value={identity.address}>
                  {identity.address}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Row>
      {props.signatures.length > 0 ? (
        <Row label="Signature">
          <Select
            value={signatureChoiceValue(props.signatureChoice)}
            onValueChange={(value) => props.setSignatureChoice(parseSignatureChoice(value))}
          >
            <SelectTrigger
              aria-label="Signature"
              className="h-10 rounded-none border-0 bg-transparent px-0 shadow-none focus:ring-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="default">
                  Default for this address
                  {props.defaultSignatureName ? ` — ${props.defaultSignatureName}` : " — none"}
                </SelectItem>
                <SelectItem value="none">No signature</SelectItem>
                {props.signatureChoice.mode === "specific" &&
                props.signatureChoice.signatureId &&
                !props.signatures.some(
                  (signature) => signature.id === props.signatureChoice.signatureId
                ) ? (
                  <SelectItem value={`signature:${props.signatureChoice.signatureId}`}>
                    Saved draft signature
                  </SelectItem>
                ) : null}
                {props.signatures.map((signature) => (
                  <SelectItem key={signature.id} value={`signature:${signature.id}`}>
                    {signature.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Row>
      ) : null}
      <Row label="To" border={false}>
        <RecipientInput
          aria-describedby={recipientHintId}
          aria-label="To"
          autoFocus={props.mode !== "reply"}
          data-compose-autofocus={props.mode !== "reply" ? "" : undefined}
          multiple
          placeholder="name@example.com, another@example.com"
          required
          type="email"
          value={props.to}
          onValueChange={props.setTo}
        />
      </Row>
      <p className="border-b pb-2 pl-12 text-xs text-muted-foreground" id={recipientHintId}>
        Separate multiple addresses with commas.
      </p>
      <div className="grid grid-cols-1 border-b sm:grid-cols-2 sm:divide-x">
        <Row label="Cc" border={false}>
          <RecipientInput
            aria-describedby={recipientHintId}
            aria-label="Cc"
            multiple
            placeholder="Add addresses"
            type="email"
            value={props.cc}
            onValueChange={props.setCc}
          />
        </Row>
        <div className="sm:pl-4">
          <Row label="Bcc" border={false}>
            <RecipientInput
              aria-describedby={recipientHintId}
              aria-label="Bcc"
              multiple
              placeholder="Add addresses"
              type="email"
              value={props.bcc}
              onValueChange={props.setBcc}
            />
          </Row>
        </div>
      </div>
      {props.mode !== "reply" ? (
        <Row label="Subject">
          <Input
            aria-label="Subject"
            required
            value={props.subject}
            onChange={(event) => props.setSubject(event.target.value)}
          />
        </Row>
      ) : null}
    </div>
  );
}
function Row({
  label,
  children,
  border = true
}: {
  label: string;
  children: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div className={`grid grid-cols-[3rem_minmax(0,1fr)] items-center ${border ? "border-b" : ""}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="[&_input]:h-10 [&_input]:rounded-none [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-0 [&_input]:shadow-none [&_input]:focus-visible:ring-0">
        {children}
      </div>
    </div>
  );
}
