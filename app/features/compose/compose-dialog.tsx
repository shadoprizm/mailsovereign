import * as React from "react";
import { toast } from "sonner";

import {
  createDraft,
  deleteDraft,
  deleteDraftAttachment,
  listDrafts,
  uploadDraftAttachment
} from "@/features/drafts/api";
import { DiscardDraftDialog } from "@/features/drafts/discard-draft-dialog";
import type { Draft, DraftAttachment } from "@/features/drafts/types";
import { listSignaturePreferences } from "@/features/signatures/api";
import {
  applySignatureToHtml,
  defaultSignatureChoice,
  editableMessageTextFromHtml,
  htmlForSending,
  replaceEditableMessageTextInHtml,
  signatureForChoice,
  signatureTextFromHtml
} from "@/features/signatures/signature-content";
import type { SignatureChoice, SignaturePreferences } from "@/features/signatures/types";
import { playNotificationSound } from "@/lib/notification-sounds";

import { replyToMessage, sendMessage } from "./api";
import { ComposeForm } from "./compose-form";
import {
  type ComposeDialogProps,
  composeTitle,
  type DraftSaveState,
  defaultSendingIdentity,
  draftRecoveryKey,
  draftStatus,
  findDraftForComposer,
  forwardedMessage,
  normalizeDraftHtml,
  readDraftRecovery,
  replySendingIdentity,
  sendingIdentities,
  splitRecipients
} from "./compose-state";
import { ComposeSurface } from "./compose-surface";
import { useDraftAutosave } from "./use-draft-autosave";

export function ComposeDialog({
  defaultFromMailboxId = null,
  draftId = null,
  mailboxes,
  message = null,
  mode = "new",
  open,
  presentation = "window",
  threadContext,
  onDraftsChange,
  onOpenChange,
  onSent
}: ComposeDialogProps): React.ReactElement | null {
  const identities = React.useMemo(() => sendingIdentities(mailboxes), [mailboxes]);
  const defaultIdentity = React.useMemo(
    () => defaultSendingIdentity(defaultFromMailboxId, mailboxes, identities),
    [defaultFromMailboxId, identities, mailboxes]
  );
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [cc, setCc] = React.useState("");
  const [bcc, setBcc] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [html, setHtml] = React.useState("<p></p>");
  const [text, setText] = React.useState("");
  const [signaturePreferences, setSignaturePreferences] = React.useState<SignaturePreferences>({
    signatures: [],
    defaults: {}
  });
  const [signatureChoice, setSignatureChoice] = React.useState<SignatureChoice>(
    defaultSignatureChoice()
  );
  const [attachments, setAttachments] = React.useState<DraftAttachment[]>([]);
  const [isPending, setIsPending] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [saveState, setSaveState] = React.useState<DraftSaveState>("saved");
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const initialized = React.useRef(false);
  const onDraftsChangeRef = React.useRef(onDraftsChange);
  const onOpenChangeRef = React.useRef(onOpenChange);
  onDraftsChangeRef.current = onDraftsChange;
  onOpenChangeRef.current = onOpenChange;
  const formId = React.useId();
  const replyToMessageId = mode === "reply" ? (message?.id ?? null) : null;
  const forwardOfMessageId = mode === "forward" ? (message?.id ?? null) : null;
  const recoveryKey = draft?.id
    ? draftRecoveryKey(draft.id)
    : draftId
      ? draftRecoveryKey(draftId)
      : null;
  const { initializeAutosave, resetAutosave } = useDraftAutosave({
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
    signatureMode: signatureChoice.mode,
    signatureId: signatureChoice.signatureId,
    setDraft,
    setSaveState
  });

  React.useEffect(() => {
    if (!open) return;
    initialized.current = false;
    void (async () => {
      try {
        const [drafts, preferences] = await Promise.all([
          draftId ? listDrafts() : Promise.resolve([]),
          listSignaturePreferences()
        ]);
        setSignaturePreferences(preferences);
        const existing = findDraftForComposer(drafts, draftId);
        if (draftId && !existing) {
          throw new Error("Draft not found.");
        }
        const forwarded = mode === "forward" && message ? forwardedMessage(message) : null;
        const preferredIdentity =
          mode === "reply" && message
            ? replySendingIdentity(message, identities, defaultIdentity)
            : defaultIdentity;
        const initialChoice = existing
          ? existing.signatureMode === "specific" && !existing.signatureId
            ? { mode: "none" as const, signatureId: null }
            : { mode: existing.signatureMode, signatureId: existing.signatureId }
          : defaultSignatureChoice(
              preferredIdentity
                ? (preferences.defaults[preferredIdentity.address.toLowerCase()] ?? null)
                : null
            );
        const initialHtml = existing
          ? existing.html
          : applySignatureToHtml(
              forwarded?.html ?? "<p></p>",
              signatureForChoice(preferences, preferredIdentity?.address ?? "", initialChoice),
              mode === "forward" ? "before-quote" : "end"
            );
        const initial =
          existing ??
          (await createDraft({
            mailboxId: preferredIdentity?.mailboxId ?? null,
            replyToMessageId,
            forwardOfMessageId,
            signatureMode: initialChoice.mode,
            signatureId: initialChoice.signatureId,
            from: preferredIdentity?.address ?? "",
            to: mode === "reply" && message ? [message.fromAddress] : [],
            cc: [],
            bcc: [],
            subject:
              mode === "reply" && message
                ? `Re: ${message.subject.replace(/^re:\s*/i, "")}`
                : mode === "forward" && message
                  ? `Fwd: ${message.subject.replace(/^(fw|fwd):\s*/i, "")}`
                  : "",
            text: signatureTextFromHtml(initialHtml),
            html: initialHtml
          }));
        if (!existing) onDraftsChangeRef.current?.();
        const recovered = readDraftRecovery(draftRecoveryKey(initial.id), initial.updatedAt);
        setDraft(initial);
        initializeAutosave(initial);
        setSignatureChoice({
          mode: recovered?.signatureMode ?? initial.signatureMode,
          signatureId: recovered?.signatureId ?? initial.signatureId
        });
        setFrom(recovered?.from ?? initial.from);
        setTo(recovered?.to ?? initial.to.join(", "));
        setCc(recovered?.cc ?? initial.cc.join(", "));
        setBcc(recovered?.bcc ?? initial.bcc.join(", "));
        setSubject(recovered?.subject ?? initial.subject);
        setText(recovered?.text ?? initial.text);
        setHtml(recovered?.html ?? (initial.html || "<p></p>"));
        setAttachments(initial.attachments);
        setSaveState("saved");
        initialized.current = true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Draft could not be opened.");
        if (draftId) onOpenChangeRef.current(false);
      }
    })();
  }, [
    open,
    message,
    mode,
    identities,
    defaultIdentity,
    draftId,
    replyToMessageId,
    forwardOfMessageId,
    initializeAutosave
  ]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setIsPending(true);
    try {
      const common = {
        from,
        text,
        html: htmlForSending(normalizeDraftHtml(text, html)),
        attachmentIds: attachments.map((attachment) => attachment.id),
        draftId: draft.id
      };
      if (mode === "reply" && message) {
        await replyToMessage({
          ...common,
          messageId: message.id,
          to: splitRecipients(to),
          cc: splitRecipients(cc),
          bcc: splitRecipients(bcc)
        });
      } else {
        await sendMessage({
          ...common,
          to: splitRecipients(to),
          cc: splitRecipients(cc),
          bcc: splitRecipients(bcc),
          subject
        });
      }
      playNotificationSound("outgoing-email");
      toast.success(mode === "reply" ? "Reply sent." : "Message sent.", {
        id: `outgoing-email:${draft.id}`
      });
      initialized.current = false;
      setDraft(null);
      resetAutosave();
      localStorage.removeItem(draftRecoveryKey(draft.id));
      onOpenChange(false);
      onDraftsChange?.();
      onSent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sending failed.");
    } finally {
      setIsPending(false);
    }
  }

  const upload = React.useCallback(
    async (files: File[]) => {
      if (!draft || files.length === 0) return;
      setIsUploading(true);
      try {
        for (const file of files) {
          const item = await uploadDraftAttachment(draft.id, file);
          setAttachments((current) => [...current, item]);
        }
        toast.success("Attachment added.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Upload failed.");
      } finally {
        setIsUploading(false);
      }
    },
    [draft]
  );
  async function removeAttachment(item: DraftAttachment) {
    if (!draft) return;
    await deleteDraftAttachment(draft.id, item.id);
    setAttachments((current) => current.filter((attachment) => attachment.id !== item.id));
  }

  async function discard() {
    if (draft) await deleteDraft(draft.id);
    initialized.current = false;
    setDraft(null);
    resetAutosave();
    if (draft) localStorage.removeItem(draftRecoveryKey(draft.id));
    onOpenChange(false);
    onDraftsChange?.();
    toast.success("Draft discarded.");
  }

  if (!open) return null;
  const sendDisabled =
    isPending ||
    isUploading ||
    !draft ||
    identities.length === 0 ||
    !text.trim() ||
    splitRecipients(to).length === 0;
  const content = (
    <ComposeForm
      attachments={attachments}
      aiCurrentText={editableMessageTextFromHtml(html, mode)}
      bcc={bcc}
      cc={cc}
      formId={formId}
      from={from}
      html={html}
      identities={identities}
      isPending={isPending}
      messageId={message?.id ?? null}
      mode={mode}
      presentation={presentation}
      ready={Boolean(draft && initialized.current)}
      sendDisabled={sendDisabled}
      subject={subject}
      signatures={signaturePreferences.signatures}
      signatureChoice={signatureChoice}
      defaultSignatureName={
        signatureForChoice(signaturePreferences, from, defaultSignatureChoice())?.name ?? null
      }
      threadContext={threadContext}
      to={to}
      discardDisabled={isPending || isUploading || !draft}
      onDiscard={() => setDiscardOpen(true)}
      onUseAiProposal={(proposal) => {
        setHtml((current) => {
          const next = replaceEditableMessageTextInHtml(current, proposal, mode);
          setText(signatureTextFromHtml(next));
          return next;
        });
        toast.success("AI proposal added. You can keep editing before you send.");
      }}
      onEditorChange={(nextHtml, nextText) => {
        setHtml(nextHtml);
        setText(nextText);
      }}
      onFiles={(files) => void upload(files)}
      onRemoveAttachment={(item) => void removeAttachment(item)}
      onSetBcc={setBcc}
      onSetCc={setCc}
      onSetFrom={(nextFrom) => {
        setFrom(nextFrom);
        if (signatureChoice.mode !== "default") return;
        const nextSignature = signatureForChoice(
          signaturePreferences,
          nextFrom,
          defaultSignatureChoice()
        );
        setSignatureChoice(defaultSignatureChoice(nextSignature?.id ?? null));
        setHtml((current) => {
          const next = applySignatureToHtml(
            current,
            nextSignature,
            mode === "forward" ? "before-quote" : "end"
          );
          setText(signatureTextFromHtml(next));
          return next;
        });
      }}
      onSetSignatureChoice={(choice) => {
        const nextSignature = signatureForChoice(signaturePreferences, from, choice);
        const persistedChoice =
          choice.mode === "default" ? defaultSignatureChoice(nextSignature?.id ?? null) : choice;
        setSignatureChoice(persistedChoice);
        setHtml((current) => {
          const next = applySignatureToHtml(
            current,
            nextSignature,
            mode === "forward" ? "before-quote" : "end"
          );
          setText(signatureTextFromHtml(next));
          return next;
        });
      }}
      onSetSubject={setSubject}
      onSetTo={setTo}
      onSubmit={(event) => void handleSubmit(event)}
    />
  );

  return (
    <>
      <ComposeSurface
        formId={formId}
        open={open}
        presentation={presentation}
        sendDisabled={sendDisabled}
        status={draftStatus(saveState)}
        title={composeTitle(mode)}
        onOpenChange={onOpenChange}
      >
        {content}
      </ComposeSurface>
      <DiscardDraftDialog open={discardOpen} onConfirm={discard} onOpenChange={setDiscardOpen} />
    </>
  );
}
