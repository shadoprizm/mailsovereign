import { Check, Clipboard, ListChecks, MessageSquareText, Sparkles } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

import { runConversationAiAction } from "./api";
import type { AiActionResult, AiFeatureId, AiModelId } from "./types";

const actions: Array<{
  id: AiFeatureId;
  label: string;
  icon: typeof Sparkles;
}> = [
  { id: "summarize", label: "Summarize", icon: Sparkles },
  { id: "draft_reply", label: "Draft reply", icon: MessageSquareText },
  { id: "extract_tasks", label: "Extract tasks", icon: ListChecks }
];

export function ConversationAi({ messageId }: { messageId: string }): React.ReactElement {
  const [model, setModel] = React.useState<AiModelId>("fast");
  const [pending, setPending] = React.useState<AiFeatureId | null>(null);
  const [result, setResult] = React.useState<AiActionResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function run(feature: AiFeatureId): Promise<void> {
    setPending(feature);
    setError(null);
    setCopied(false);
    try {
      setResult(await runConversationAiAction({ feature, messageId, model }));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The AI action could not be completed.");
    } finally {
      setPending(null);
    }
  }

  async function copyResult(): Promise<void> {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
  }

  return (
    <section className="mb-4 rounded-lg border bg-card p-4" aria-label="Sovereign AI">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4" />
            Sovereign AI
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Runs only when selected. Results are not saved or sent automatically.
          </p>
        </div>
        <Select value={model} onValueChange={(value: AiModelId) => setModel(value)}>
          <SelectTrigger aria-label="AI model" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">Fast model</SelectItem>
            <SelectItem value="quality">Quality model</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              disabled={pending !== null}
              key={action.id}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void run(action.id)}
            >
              <Icon />
              {pending === action.id ? "Working…" : action.label}
            </Button>
          );
        })}
      </div>

      {error ? (
        <p className="mt-4 text-sm text-destructive">
          {error}{" "}
          <a className="underline" href="/settings/ai">
            View AI plans
          </a>
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-md bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {result.creditsCharged} credit{result.creditsCharged === 1 ? "" : "s"} used ·{" "}
              {result.creditsRemaining.toLocaleString()} remaining
            </p>
            <Button size="sm" type="button" variant="ghost" onClick={() => void copyResult()}>
              {copied ? <Check /> : <Clipboard />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{result.text}</p>
        </div>
      ) : null}
    </section>
  );
}
