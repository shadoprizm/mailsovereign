import { Paperclip, Trash2 } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { ComposeAi } from "@/features/ai/compose-ai";
import type { DraftAttachment } from "@/features/drafts/types";
import type { EmailSignature, SignatureChoice } from "@/features/signatures/types";
import { cn } from "@/lib/cn";
import { AttachmentList } from "./attachment-list";
import { ComposeFields, type SendingIdentity } from "./compose-fields";
import { submitComposeOnShortcut } from "./compose-shortcuts";
import type { ComposeMode } from "./compose-state";
import { RichEmailEditor } from "./rich-email-editor";

type ComposeFormProps = {
  attachments: DraftAttachment[];
  aiCurrentText: string;
  bcc: string;
  cc: string;
  formId: string;
  from: string;
  html: string;
  identities: SendingIdentity[];
  isPending: boolean;
  messageId: string | null;
  mode: ComposeMode;
  presentation: "window" | "thread";
  ready: boolean;
  sendDisabled: boolean;
  subject: string;
  signatures: EmailSignature[];
  signatureChoice: SignatureChoice;
  defaultSignatureName: string | null;
  discardDisabled: boolean;
  threadContext?: React.ReactNode;
  to: string;
  onDiscard: () => void;
  onUseAiProposal: (text: string) => void;
  onEditorChange: (html: string, text: string) => void;
  onFiles: (files: File[]) => void;
  onRemoveAttachment: (attachment: DraftAttachment) => void;
  onSetBcc: (value: string) => void;
  onSetCc: (value: string) => void;
  onSetFrom: (value: string) => void;
  onSetSubject: (value: string) => void;
  onSetSignatureChoice: (value: SignatureChoice) => void;
  onSetTo: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function ComposeForm(props: ComposeFormProps): React.ReactElement {
  return (
    <>
      {!props.ready ? (
        <div className="grid min-h-60 flex-1 place-items-center text-sm text-muted-foreground">
          Opening draft…
        </div>
      ) : (
        <form
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            props.presentation === "thread" && "lg:flex-none"
          )}
          id={props.formId}
          onKeyDownCapture={(event) => submitComposeOnShortcut(event, props.sendDisabled)}
          onSubmit={props.onSubmit}
        >
          <div
            className={cn(
              props.presentation === "window" && "min-h-0 flex-1 overflow-y-auto overscroll-contain"
            )}
          >
            <ComposeFields
              identities={props.identities}
              mode={props.mode}
              from={props.from}
              to={props.to}
              cc={props.cc}
              bcc={props.bcc}
              subject={props.subject}
              signatures={props.signatures}
              signatureChoice={props.signatureChoice}
              defaultSignatureName={props.defaultSignatureName}
              setFrom={props.onSetFrom}
              setTo={props.onSetTo}
              setCc={props.onSetCc}
              setBcc={props.onSetBcc}
              setSubject={props.onSetSubject}
              setSignatureChoice={props.onSetSignatureChoice}
            />
            <ComposeAi
              currentText={props.aiCurrentText}
              from={props.from}
              messageId={props.messageId}
              mode={props.mode}
              subject={props.subject}
              to={splitAiRecipients(props.to)}
              onUseProposal={props.onUseAiProposal}
            />
            <RichEmailEditor
              contained={false}
              html={props.html}
              onFiles={props.onFiles}
              onChange={props.onEditorChange}
            />
            <AttachmentList attachments={props.attachments} onRemove={props.onRemoveAttachment} />
          </div>
          <footer
            className={cn(
              "flex shrink-0 items-center justify-between gap-2 border-t bg-background/50 px-5 py-3",
              props.presentation === "window" &&
                "pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-3"
            )}
          >
            <div className="flex gap-2">
              <Button
                className={cn(props.presentation === "thread" && "hidden lg:inline-flex")}
                disabled={props.sendDisabled}
                type="submit"
              >
                {props.isPending ? "Sending" : "Send"}
              </Button>
              <Button asChild size="icon" type="button" variant="ghost">
                <label aria-label="Add attachment" className="cursor-pointer">
                  <Paperclip />
                  <input
                    className="sr-only"
                    multiple
                    type="file"
                    onChange={(event) => {
                      props.onFiles(Array.from(event.target.files ?? []));
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </Button>
            </div>
            <Button
              aria-label="Discard draft"
              disabled={props.discardDisabled}
              size="icon"
              type="button"
              variant="ghost"
              onClick={props.onDiscard}
            >
              <Trash2 />
            </Button>
          </footer>
        </form>
      )}
      {props.presentation === "thread" && props.threadContext ? (
        <div className="border-t bg-background lg:hidden">
          <div className="border-b px-4 py-3 text-xs font-medium text-muted-foreground">
            Conversation
          </div>
          {props.threadContext}
        </div>
      ) : null}
    </>
  );
}

function splitAiRecipients(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((recipient) => recipient.trim())
    .filter((recipient) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient));
}
