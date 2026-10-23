import { RefreshCw, Sparkles } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type { AiModelId } from "@/features/ai/types";
import {
  applyBulkOrganization,
  currentBulkOrganization,
  getBulkOrganizationAvailability,
  retryBulkOrganization,
  startBulkOrganization,
  undoBulkOrganization
} from "./api";
import { MailLabelBadge } from "./label-badge";
import type {
  BulkOrganizationAvailability,
  BulkOrganizationRun,
  BulkOrganizationScope
} from "./types";

export function BulkOrganizationDialog({
  open,
  onChanged,
  onOpenChange
}: {
  open: boolean;
  onChanged: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const [scope, setScope] = React.useState<BulkOrganizationScope>("new");
  const [availability, setAvailability] = React.useState<BulkOrganizationAvailability | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [model, setModel] = React.useState<AiModelId>("fast");
  const [run, setRun] = React.useState<BulkOrganizationRun | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const active = run?.status === "queued" || run?.status === "running";

  const refresh = React.useCallback(async () => {
    const current = await currentBulkOrganization();
    setRun(current);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setScope("new");
    setAvailability(null);
    setLoadError(null);
    void Promise.all([currentBulkOrganization(), getBulkOrganizationAvailability()])
      .then(([current, counts]) => {
        if (!cancelled) {
          setRun(current);
          setAvailability(counts);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Organization status is unavailable."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open || !active) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [active, open, refresh]);

  async function refreshAvailability(): Promise<void> {
    try {
      setAvailability(await getBulkOrganizationAvailability());
      setLoadError(null);
    } catch {
      setAvailability(null);
      setLoadError("Could not load mail counts. Close and reopen this window to retry.");
    }
  }

  async function start(): Promise<void> {
    setPending(true);
    try {
      setRun(await startBulkOrganization(model, scope));
      toast.success("Inbox organization started. You can close this window while it runs.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Inbox organization could not start.");
    } finally {
      setPending(false);
    }
  }

  async function retry(): Promise<void> {
    if (!run) return;
    setPending(true);
    try {
      setRun(await retryBulkOrganization(run.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Organization could not resume.");
    } finally {
      setPending(false);
    }
  }

  async function apply(): Promise<void> {
    if (!run) return;
    setPending(true);
    try {
      const result = await applyBulkOrganization(run.id);
      setRun(result.run);
      await refreshAvailability();
      await onChanged();
      toast.success(`AI labels applied to ${run.suggestedCount.toLocaleString()} conversations.`, {
        action: {
          label: "Undo",
          onClick: () => {
            void undoBulkOrganization(run.id)
              .then((undone) => {
                setRun(undone.run);
                return Promise.all([refreshAvailability(), onChanged()]);
              })
              .then(() => toast.success("Previous AI labels restored."))
              .catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : "Undo failed.")
              );
          }
        }
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI labels could not be applied.");
    } finally {
      setPending(false);
    }
  }

  const showStart = !run || run.status === "applied" || run.status === "undone";
  const selectedCount = (scope === "new" ? availability?.newCount : availability?.totalCount) ?? 0;
  const runTotal = run?.totalCount ?? selectedCount;
  const progress = runTotal ? Math.round(((run?.processedCount ?? 0) / runTotal) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Organize inbox</DialogTitle>
          <DialogDescription>
            Organize new mail or reclassify your entire inbox using the same AI configuration as
            email drafting. Nothing is applied until you review the totals.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading organization status…</p>
        ) : null}

        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        ) : null}

        {!loading && showStart && availability ? (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Which mail should be organized?</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
                <input
                  type="radio"
                  name="organization-scope"
                  value="new"
                  checked={scope === "new"}
                  disabled={pending}
                  onChange={() => setScope("new")}
                  className="mt-1 accent-primary"
                />
                <span>
                  <span className="block font-medium">
                    New mail · {availability.newCount.toLocaleString()} conversations
                  </span>
                  <span className="text-muted-foreground">
                    Not yet organized, or with new incoming messages since their last organization.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
                <input
                  type="radio"
                  name="organization-scope"
                  value="all"
                  checked={scope === "all"}
                  disabled={pending}
                  onChange={() => setScope("all")}
                  className="mt-1 accent-primary"
                />
                <span>
                  <span className="block font-medium">
                    Entire inbox · {availability.totalCount.toLocaleString()} conversations
                  </span>
                  <span className="text-muted-foreground">
                    Reclassify every inbox conversation, including previously organized mail.
                  </span>
                </span>
              </label>
            </fieldset>
            {scope === "new" && availability.newCount === 0 ? (
              <p className="rounded-md bg-muted p-3 text-sm">
                You’re caught up. There is no new mail to organize.
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {selectedCount.toLocaleString()} conversations will be analyzed. Attachments and
              remote content are excluded. Estimated cost:{" "}
              {(selectedCount * (model === "quality" ? 4 : 1)).toLocaleString()} built-in AI
              credits. With your own API key, no Sovereign credits are used; your provider’s charges
              apply.
            </p>
            <Select value={model} onValueChange={(value: AiModelId) => setModel(value)}>
              <SelectTrigger aria-label="Inbox organization AI model" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast model</SelectItem>
                <SelectItem value="quality">Quality model</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {!loading && run && !showStart ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>{statusLabel(run)}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {run.processedCount.toLocaleString()} / {run.totalCount.toLocaleString()}
                </span>
              </div>
              <Progress aria-label="Inbox organization progress" value={progress} />
            </div>

            {run.status === "paused" ? (
              <p className="rounded-md border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                {pausedMessage(run.lastErrorCode)} Completed batches are saved and will not be
                repeated.
              </p>
            ) : null}

            {run.labelCounts.length ? (
              <div className="max-h-[38vh] space-y-2 overflow-auto pr-1">
                {run.labelCounts.map(({ label, count }) => (
                  <div
                    className="flex items-center gap-3 rounded-md border px-3 py-2"
                    key={label.id}
                  >
                    <MailLabelBadge label={label} />
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {run.status === "completed" ? (
              <p className="text-sm text-muted-foreground">
                {run.suggestedCount.toLocaleString()} conversations have clear label suggestions.
                Applying them replaces earlier AI categories for this snapshot while preserving
                manual labels.
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          {showStart ? (
            <Button
              disabled={loading || pending || !availability || selectedCount === 0 || !!loadError}
              onClick={() => void start()}
            >
              <Sparkles />
              {pending
                ? "Starting…"
                : scope === "new"
                  ? `Organize ${selectedCount.toLocaleString()} new`
                  : `Reorganize all ${selectedCount.toLocaleString()}`}
            </Button>
          ) : null}
          {run?.status === "paused" ? (
            <Button disabled={pending} onClick={() => void retry()}>
              <RefreshCw />
              {pending ? "Resuming…" : "Resume"}
            </Button>
          ) : null}
          {run?.status === "completed" ? (
            <Button disabled={pending} onClick={() => void apply()}>
              {pending ? "Applying…" : "Apply reviewed labels"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function statusLabel(run: BulkOrganizationRun): string {
  if (run.status === "queued") return "Queued";
  if (run.status === "running") return "Organizing inbox";
  if (run.status === "paused") return "Paused";
  if (run.status === "completed") return "Ready to review";
  if (run.status === "applied") return "Applied";
  return "Undone";
}

function pausedMessage(code: string | null): string {
  if (code === "AI_CREDITS_REQUIRED")
    return "The current AI credit balance is too low to continue.";
  if (code === "AI_PROVIDER_UNAVAILABLE") return "The AI provider did not return a valid batch.";
  if (code === "MAILBOX_FORBIDDEN") return "Mailbox access changed while this run was processing.";
  if (code === "ORGANIZATION_QUEUE_UNAVAILABLE")
    return "The background queue was temporarily unavailable.";
  return "The run could not continue with the current AI configuration.";
}
