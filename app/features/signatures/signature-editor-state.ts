import type { Mailbox } from "@/features/mailboxes/types";
import {
  buildProfessionalSignature,
  defaultProfessionalSignatureDesign,
  type ProfessionalSignatureDesign,
  professionalSignatureDesignFromHtml
} from "./professional-signature";
import type { EmailSignature } from "./types";

export type SignatureEditorState = Pick<EmailSignature, "name" | "html" | "text"> & {
  design: ProfessionalSignatureDesign | null;
  id: string | null;
};

export function signatureEditorFromSignature(signature: EmailSignature): SignatureEditorState {
  return {
    id: signature.id,
    name: signature.name,
    html: signature.html,
    text: signature.text,
    design: professionalSignatureDesignFromHtml(signature.html)
  };
}

export function newProfessionalSignatureEditor(): SignatureEditorState {
  const design = defaultProfessionalSignatureDesign();
  return { id: null, name: "", ...buildProfessionalSignature(design), design };
}

export function newSimpleSignatureEditor(): SignatureEditorState {
  return { id: null, name: "", html: "<p></p>", text: "", design: null };
}

export function signatureInput(
  editor: SignatureEditorState
): Pick<EmailSignature, "name" | "html" | "text"> {
  return { name: editor.name, html: editor.html, text: editor.text };
}

export function sendingAddresses(mailboxes: Mailbox[]): string[] {
  return mailboxes
    .filter(
      (mailbox) =>
        mailbox.isActive && (mailbox.accessLevel === "agent" || mailbox.accessLevel === "manager")
    )
    .flatMap((mailbox) =>
      mailbox.addresses.length
        ? mailbox.addresses
            .filter((address) => address.sendEnabled)
            .map((address) => address.address)
        : [mailbox.address]
    );
}
