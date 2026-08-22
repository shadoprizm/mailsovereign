import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { runComposeAiAction } from "./api";
import type { AiComposeMode, AiComposeResult, AiModelId } from "./types";

type ComposeAiProps = {
  currentText: string;
  from: string;
  messageId: string | null;
  mode: AiComposeMode;
  subject: string;
  to: string[];
  onUseProposal: (text: string) => void;
};

export function ComposeAi(props: ComposeAiProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const [instruction, setInstruction] = React.useState("");
  const [model, setModel] = React.useState<AiModelId>("fast");
  const [pending, setPending] = React.useState(false);
  const [proposal, setProposal] = React.useState<AiComposeResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const instructionId = React.useId();

  async function generate(): Promise<void> {
    if (!props.from) return;
    setPending(true);
    setError(null);
    try {
      setProposal(
        await runComposeAiAction({
          mode: props.mode,
          messageId: props.messageId,
          model,
          instruction,
          from: props.from,
          to: props.to,
          subject: props.subject,
          currentText: props.currentText
        })
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Sovereign AI could not create a draft.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="border-b bg-muted/20" aria-label="Sovereign AI writing assistant">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <Button
          aria-expanded={expanded}
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => setExpanded((current) => !current)}
        >
          <Sparkles />
          Sovereign AI
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </Button>
        {!expanded ? (
          <p className="text-xs text-muted-foreground">Write, revise, or adjust the tone</p>
        ) : null}
      </div>

      {expanded ? (
        <div className="space-y-3 border-t px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor={instructionId}>What should Sovereign AI do?</FieldLabel>
              <Textarea
                className="min-h-20 resize-y"
                id={instructionId}
                maxLength={4_000}
                placeholder="Example: Make this warmer and more concise, and end with a clear next step."
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
              />
              <FieldDescription>
                Your saved writing profile is applied automatically. The current draft will not
                change until you use the proposal.
              </FieldDescription>
            </Field>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Select value={model} onValueChange={(value: AiModelId) => setModel(value)}>
                <SelectTrigger aria-label="AI model" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">Fast model</SelectItem>
                  <SelectItem value="quality">Quality model</SelectItem>
                </SelectContent>
              </Select>
              <Button
                disabled={pending || !props.from}
                type="button"
                onClick={() => void generate()}
              >
                <Sparkles />
                {pending ? "Writing…" : proposal ? "Try again" : "Create proposal"}
              </Button>
            </div>
          </div>

          {!props.from ? (
            <p className="text-xs text-muted-foreground">Choose a From address before using AI.</p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive">
              {error}{" "}
              <a className="underline" href="/settings/ai">
                AI settings
              </a>
            </p>
          ) : null}

          {proposal ? (
            <div className="rounded-md border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Proposal only · {proposal.creditsCharged} credit
                  {proposal.creditsCharged === 1 ? "" : "s"} used ·{" "}
                  {proposal.creditsRemaining.toLocaleString()} remaining
                </p>
                <Button
                  size="sm"
                  type="button"
                  onClick={() => {
                    props.onUseProposal(proposal.text);
                    setProposal(null);
                    setExpanded(false);
                  }}
                >
                  Use proposal
                </Button>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{proposal.text}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                Don&apos;t like it? Change the instruction and choose Try again. Your current draft
                remains untouched until you use a proposal.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
