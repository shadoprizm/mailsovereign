import * as React from "react";
import { toast } from "sonner";
import { updateDraft } from "@/features/drafts/api";
import type { Draft } from "@/features/drafts/types";
import type { SendingIdentity } from "./compose-fields";
import {
  type DraftSaveState,
  normalizeDraftHtml,
  recipientInputsAreValid,
  serializeDraft,
  splitRecipients
} from "./compose-state";
import { DraftSaveQueue } from "./draft-save-queue";

type DraftAutosaveOptions = {
  open: boolean;
  initialized: React.RefObject<boolean>;
  draft: Draft | null;
  identities: SendingIdentity[];
  recoveryKey: string | null;
  replyToMessageId: string | null;
  forwardOfMessageId: string | null;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  html: string;
  signatureMode: Draft["signatureMode"];
  signatureId: string | null;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  setSaveState: React.Dispatch<React.SetStateAction<DraftSaveState>>;
};

export function useDraftAutosave(options: DraftAutosaveOptions) {
  const {
    open,
    initialized,
    draft,
    identities,
    recoveryKey,
    replyToMessageId,
    forwardOfMessageId,
    from,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    signatureMode,
    signatureId,
    setDraft,
    setSaveState
  } = options;
  const draftRef = React.useRef<Draft | null>(null);
  const lastSaved = React.useRef("");
  const latestSnapshot = React.useRef("");
  const saveQueue = React.useRef(new DraftSaveQueue());

  const initializeAutosave = React.useCallback((initial: Draft) => {
    draftRef.current = initial;
    lastSaved.current = serializeDraft(
      initial.from,
      initial.to.join(", "),
      initial.cc.join(", "),
      initial.bcc.join(", "),
      initial.subject,
      initial.text,
      initial.html,
      initial.signatureMode,
      initial.signatureId
    );
    latestSnapshot.current = lastSaved.current;
  }, []);

  const resetAutosave = React.useCallback(() => {
    draftRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!open || !recoveryKey || !initialized.current) return;
    localStorage.setItem(
      recoveryKey,
      JSON.stringify({
        from,
        to,
        cc,
        bcc,
        subject,
        text,
        html,
        signatureMode,
        signatureId,
        savedAt: Date.now()
      })
    );
  }, [
    open,
    initialized,
    recoveryKey,
    from,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    signatureMode,
    signatureId
  ]);

  React.useEffect(() => {
    if (!open || !draft || !initialized.current) return;
    const snapshot = serializeDraft(
      from,
      to,
      cc,
      bcc,
      subject,
      text,
      html,
      signatureMode,
      signatureId
    );
    latestSnapshot.current = snapshot;
    if (snapshot === lastSaved.current) {
      setSaveState("saved");
      return;
    }
    if (!recipientInputsAreValid(to, cc, bcc)) {
      setSaveState("editing-recipient");
      return;
    }
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void saveQueue.current.enqueue(async () => {
        const current = draftRef.current;
        if (
          !current ||
          !initialized.current ||
          snapshot !== latestSnapshot.current ||
          snapshot === lastSaved.current
        ) {
          if (latestSnapshot.current === lastSaved.current) setSaveState("saved");
          return;
        }
        try {
          const next = await updateDraft(current.id, {
            mailboxId: identities.find((identity) => identity.address === from)?.mailboxId ?? null,
            replyToMessageId,
            forwardOfMessageId,
            signatureMode,
            signatureId,
            from,
            to: splitRecipients(to),
            cc: splitRecipients(cc),
            bcc: splitRecipients(bcc),
            subject,
            text,
            html: normalizeDraftHtml(text, html),
            version: current.version
          });
          draftRef.current = next;
          lastSaved.current = snapshot;
          if (recoveryKey) localStorage.removeItem(recoveryKey);
          setDraft(next);
          setSaveState(latestSnapshot.current === snapshot ? "saved" : "saving");
        } catch (error) {
          setSaveState("error");
          toast.error(error instanceof Error ? error.message : "Draft save failed.");
        }
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    open,
    initialized,
    draft,
    from,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    signatureMode,
    signatureId,
    replyToMessageId,
    forwardOfMessageId,
    identities,
    recoveryKey,
    setDraft,
    setSaveState
  ]);

  return { initializeAutosave, resetAutosave };
}
