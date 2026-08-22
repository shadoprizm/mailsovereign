import { Download, FileUp, Sparkles } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

import { getAiWritingProfile, updateAiWritingProfile } from "./api";

const maxProfileLength = 16_000;
const starterProfile = `# My email voice

- Warm, direct, and concise
- Use plain language and short paragraphs
- Avoid buzzwords and excessive exclamation marks

## New messages

State the purpose early and end with a clear next step.

## Replies

Acknowledge the other person before answering their question.

## Forwards

Explain why I am forwarding the message and what I need from the recipient.

## Examples that sound like me

> Paste a few short email examples here.
`;

export function WritingProfileSettings(): React.ReactElement {
  const [markdown, setMarkdown] = React.useState("");
  const [savedMarkdown, setSavedMarkdown] = React.useState("");
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const fieldId = React.useId();

  React.useEffect(() => {
    let active = true;
    void getAiWritingProfile()
      .then((profile) => {
        if (!active) return;
        setMarkdown(profile.markdown);
        setSavedMarkdown(profile.markdown);
        setUpdatedAt(profile.updatedAt);
      })
      .catch((reason: unknown) => {
        toast.error(
          reason instanceof Error ? reason.message : "Writing profile could not be loaded."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const profile = await updateAiWritingProfile(markdown);
      setMarkdown(profile.markdown);
      setSavedMarkdown(profile.markdown);
      setUpdatedAt(profile.updatedAt);
      toast.success(profile.markdown ? "Writing profile saved." : "Writing profile cleared.");
    } catch (reason: unknown) {
      toast.error(reason instanceof Error ? reason.message : "Writing profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function importProfile(file: File): Promise<void> {
    const value = await file.text();
    if (value.length > maxProfileLength) {
      toast.error("Writing profile files may contain at most 16,000 characters.");
      return;
    }
    setMarkdown(value);
    toast.success("Writing profile imported. Save it when you are ready.");
  }

  function downloadProfile(): void {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sovereign-ai-writing-profile.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4" />
            My writing profile
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Private Markdown instructions and examples for your email voice.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            accept=".md,text/markdown,text/plain"
            className="sr-only"
            ref={fileInputRef}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importProfile(file);
              event.currentTarget.value = "";
            }}
          />
          <Button
            disabled={loading || saving}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp />
            Import .md
          </Button>
          <Button
            disabled={!markdown}
            size="sm"
            type="button"
            variant="outline"
            onClick={downloadProfile}
          >
            <Download />
            Download .md
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading writing profile…</p>
      ) : (
        <Field className="mt-4">
          <FieldLabel htmlFor={fieldId}>Voice, tone, and style instructions</FieldLabel>
          <Textarea
            className="min-h-72 resize-y font-mono text-sm"
            id={fieldId}
            maxLength={maxProfileLength}
            placeholder={starterProfile}
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FieldDescription>
              Add writing samples, preferred tone, words to avoid, and separate guidance for new
              messages, replies, or forwards. It is sent to the model only when you run an AI
              writing action.
            </FieldDescription>
            <span className="text-xs text-muted-foreground">
              {markdown.length.toLocaleString()} / {maxProfileLength.toLocaleString()}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={saving || markdown === savedMarkdown}
              type="button"
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save writing profile"}
            </Button>
            {!markdown ? (
              <Button type="button" variant="ghost" onClick={() => setMarkdown(starterProfile)}>
                Use starter template
              </Button>
            ) : null}
            {updatedAt ? (
              <span className="text-xs text-muted-foreground">
                Last saved {new Date(updatedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
        </Field>
      )}
    </div>
  );
}
