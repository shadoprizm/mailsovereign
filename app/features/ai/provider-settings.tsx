import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api-client";

type ProviderSummary = {
  configured: boolean;
  baseUrl: string;
  fastModel: string;
  qualityModel: string;
  hasApiKey: boolean;
};

export function AiProviderSettings({
  isOwner,
  onConfigured
}: {
  isOwner: boolean;
  onConfigured: (configured: boolean) => void;
}): React.ReactElement {
  const [saved, setSaved] = React.useState<ProviderSummary | null>(null);
  const [baseUrl, setBaseUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [fastModel, setFastModel] = React.useState("");
  const [qualityModel, setQualityModel] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const id = React.useId();

  React.useEffect(() => {
    let active = true;
    void apiGet<ProviderSummary>("/api/ai/provider")
      .then((result) => {
        if (!active) return;
        setSaved(result);
        setBaseUrl(result.baseUrl);
        setFastModel(result.fastModel);
        setQualityModel(result.qualityModel);
        onConfigured(result.configured);
      })
      .catch(() => {
        if (active) setError("Unable to load your AI provider. Reload to try again.");
      });
    return () => {
      active = false;
    };
  }, [onConfigured]);

  async function act(action: "save" | "test" | "remove"): Promise<void> {
    setPending(true);
    setError(null);
    setNotice("");
    try {
      const input = { baseUrl, apiKey, fastModel, qualityModel };
      if (action === "test") {
        await apiPost("/api/ai/provider/test", input);
        setNotice("Both model choices responded. This test has not saved your changes.");
      } else {
        const result =
          action === "save"
            ? await apiPut<ProviderSummary>("/api/ai/provider", input)
            : await apiDelete<ProviderSummary>("/api/ai/provider");
        setSaved(result);
        setApiKey("");
        setBaseUrl(result.baseUrl);
        setFastModel(result.fastModel);
        setQualityModel(result.qualityModel);
        onConfigured(result.configured);
        setNotice(
          action === "save"
            ? "Your provider is active for drafting, summaries, and inbox organization."
            : "API key removed. AI actions now use built-in access, when available."
        );
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Unable to update AI provider.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" aria-label="Use your own API key">
      <div>
        <h3 className="text-sm font-medium">Use your own API key</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect an OpenAI-compatible provider or your own gateway, such as Astra. No Sovereign AI
          plan or credits are required. Your provider’s usage charges apply.
        </p>
      </div>
      {saved ? (
        <p className="text-sm font-medium">
          {saved.configured
            ? "Your API key is active for this workspace."
            : "No custom AI provider connected."}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Loading provider settings…</p>
      )}
      {isOwner ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act("save");
          }}
        >
          <fieldset disabled={pending || !saved} className="space-y-4">
            <Field>
              <FieldLabel htmlFor={`${id}-url`}>API base URL</FieldLabel>
              <Input
                id={`${id}-url`}
                type="url"
                required
                maxLength={500}
                placeholder="https://your-gateway.example.com/v1"
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setNotice("");
                }}
              />
              <p className="text-xs text-muted-foreground">
                Use the HTTPS base URL before /chat/completions. For OpenAI, use
                https://api.openai.com/v1.
              </p>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-key`}>API key</FieldLabel>
              <Input
                id={`${id}-key`}
                type="password"
                autoComplete="new-password"
                maxLength={4096}
                value={apiKey}
                placeholder={
                  saved?.hasApiKey
                    ? "Saved securely — leave blank to keep"
                    : "Enter your provider API key"
                }
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setNotice("");
                }}
              />
              <p className="text-xs text-muted-foreground">
                Encrypted in your deployment. Changing the provider URL requires a new key.
              </p>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-fast`}>Fast model ID</FieldLabel>
                <Input
                  id={`${id}-fast`}
                  required
                  maxLength={200}
                  value={fastModel}
                  onChange={(event) => {
                    setFastModel(event.target.value);
                    setNotice("");
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-quality`}>Quality model ID</FieldLabel>
                <Input
                  id={`${id}-quality`}
                  required
                  maxLength={200}
                  value={qualityModel}
                  onChange={(event) => {
                    setQualityModel(event.target.value);
                    setNotice("");
                  }}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter exact model IDs from your provider. You can use the same model for both choices.
              Everyone in this workspace uses this connection within their existing mailbox access.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">{pending ? "Working…" : "Save and use API key"}</Button>
              <Button type="button" variant="outline" onClick={() => void act("test")}>
                Test connection
              </Button>
              {saved?.configured ? (
                <Button type="button" variant="outline" onClick={() => void act("remove")}>
                  Remove API key
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Testing sends a short sample prompt to each model, with no email content. Provider
              charges may apply. Saving does not cancel an existing AI subscription.
            </p>
          </fieldset>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only the workspace owner can change the AI provider.
          {saved?.configured ? ` Fast: ${saved.fastModel}. Quality: ${saved.qualityModel}.` : ""}
        </p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
