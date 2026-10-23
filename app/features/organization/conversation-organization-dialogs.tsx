import { Sparkles, Tag, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type { AiModelId } from "@/features/ai/types";
import type { ConversationSummary } from "@/features/messages/types";
import {
  applyConversationOrganization,
  assignConversationLabels,
  createMailLabel,
  deleteMailLabel,
  previewConversationOrganization,
  undoConversationOrganization
} from "./api";
import { MailLabelBadge } from "./label-badge";
import type { MailLabel, OrganizationPreview } from "./types";

type DialogProps = {
  conversations: ConversationSummary[];
  labels: MailLabel[];
  onChanged: () => Promise<void>;
};

export function ConversationLabelDialog({
  conversations,
  labels,
  open,
  onChanged,
  onOpenChange
}: DialogProps & { open: boolean; onOpenChange: (open: boolean) => void }): React.ReactElement {
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) setSelected(new Set());
  }, [open]);

  async function assign(operation: "add" | "remove"): Promise<void> {
    if (!selected.size) return;
    setPending(true);
    try {
      await assignConversationLabels({
        messageIds: conversations.map((conversation) => conversation.id),
        labelIds: [...selected],
        operation
      });
      await onChanged();
      onOpenChange(false);
      toast.success(
        operation === "add" ? "Labels added to selected conversations." : "Labels removed."
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Labels could not be changed.");
    } finally {
      setPending(false);
    }
  }

  async function create(): Promise<void> {
    if (!name.trim()) return;
    setPending(true);
    try {
      const label = await createMailLabel({ name: name.trim(), color: "slate" });
      setName("");
      setSelected((current) => new Set(current).add(label.id));
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Label could not be created.");
    } finally {
      setPending(false);
    }
  }

  async function removeLabel(label: MailLabel): Promise<void> {
    setPending(true);
    try {
      await deleteMailLabel(label.id);
      setSelected((current) => {
        const next = new Set(current);
        next.delete(label.id);
        return next;
      });
      await onChanged();
      toast.success(`${label.name} deleted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Label could not be deleted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Label selected conversations</DialogTitle>
          <DialogDescription>
            Labels are private to you and organize Sovereign Mail without changing provider folders.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[45vh] space-y-2 overflow-auto pr-1">
          {labels.map((label) => (
            <div className="flex min-h-11 items-center gap-3 rounded-md border px-3" key={label.id}>
              <Checkbox
                aria-label={`Select ${label.name}`}
                checked={selected.has(label.id)}
                disabled={pending}
                onCheckedChange={(checked) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked === true) next.add(label.id);
                    else next.delete(label.id);
                    return next;
                  })
                }
              />
              <MailLabelBadge label={label} />
              <span className="ml-auto text-xs text-muted-foreground">
                {label.conversationCount.toLocaleString()}
              </span>
              {!label.isSystem ? (
                <Button
                  aria-label={`Delete ${label.name}`}
                  className="size-8 text-muted-foreground hover:text-destructive"
                  disabled={pending}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => void removeLabel(label)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="New label name"
            maxLength={40}
            placeholder="Create a label"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
            }}
          />
          <Button
            disabled={pending || !name.trim()}
            type="button"
            variant="outline"
            onClick={() => void create()}
          >
            Create
          </Button>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !selected.size}
            variant="outline"
            onClick={() => void assign("remove")}
          >
            Remove
          </Button>
          <Button disabled={pending || !selected.size} onClick={() => void assign("add")}>
            <Tag />
            Add labels
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConversationOrganizationDialog({
  conversations,
  open,
  onChanged,
  onOpenChange
}: DialogProps & { open: boolean; onOpenChange: (open: boolean) => void }): React.ReactElement {
  const [model, setModel] = React.useState<AiModelId>("fast");
  const [preview, setPreview] = React.useState<OrganizationPreview | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [pending, setPending] = React.useState(false);
  const targets = conversations.slice(0, 10);

  React.useEffect(() => {
    if (!open) {
      setPreview(null);
      setSelected(new Set());
    }
  }, [open]);

  async function generate(): Promise<void> {
    setPending(true);
    try {
      const result = await previewConversationOrganization({
        messageIds: targets.map((conversation) => conversation.id),
        model
      });
      setPreview(result);
      setSelected(new Set(result.items.map((item) => `${item.messageId}:${item.label.id}`)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI organization could not run.");
    } finally {
      setPending(false);
    }
  }

  async function apply(): Promise<void> {
    if (!preview || !selected.size) return;
    setPending(true);
    try {
      const items = preview.items
        .filter((item) => selected.has(`${item.messageId}:${item.label.id}`))
        .map((item) => ({ messageId: item.messageId, labelId: item.label.id }));
      const result = await applyConversationOrganization(preview.runId, items);
      await onChanged();
      onOpenChange(false);
      toast.success("AI labels applied.", {
        action: {
          label: "Undo",
          onClick: () => {
            void undoConversationOrganization(result.runId)
              .then(onChanged)
              .then(() => toast.success("AI labels removed."))
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Organize with Sovereign AI</DialogTitle>
          <DialogDescription>
            Review suggested labels before anything changes. Mail is processed through the same AI
            configuration used for email drafting.
          </DialogDescription>
        </DialogHeader>
        {!preview ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {targets.length} {targets.length === 1 ? "conversation" : "conversations"} will be
              analyzed. Attachments are excluded. This costs{" "}
              {targets.length * (model === "quality" ? 4 : 1)} built-in AI credits. With your own
              API key, no Sovereign credits are used; your provider’s charges apply.
              {conversations.length > 10
                ? " Only the first 10 selected conversations are included."
                : ""}
            </p>
            <Select value={model} onValueChange={(value: AiModelId) => setModel(value)}>
              <SelectTrigger aria-label="Organization AI model" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast model</SelectItem>
                <SelectItem value="quality">Quality model</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : preview.items.length ? (
          <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
            {preview.items.map((item) => {
              const key = `${item.messageId}:${item.label.id}`;
              const conversation = conversations.find(
                (candidate) => candidate.threadId === item.threadId
              );
              return (
                <div className="flex items-start gap-3 rounded-md border p-3" key={key}>
                  <Checkbox
                    aria-label={`Apply ${item.label.name} to ${conversation?.subject || "selected conversation"}`}
                    checked={selected.has(key)}
                    disabled={pending}
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked === true) next.add(key);
                        else next.delete(key);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <MailLabelBadge label={item.label} />
                      <span className="truncate text-sm font-medium">
                        {conversation?.subject || "Selected conversation"}
                      </span>
                    </span>
                    <span className="block text-xs text-muted-foreground">{item.reason}</span>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-md border p-4 text-sm text-muted-foreground">
            Sovereign AI did not find a clear label for these conversations.
          </p>
        )}
        <DialogFooter>
          {preview ? (
            <Button
              disabled={pending}
              type="button"
              variant="outline"
              onClick={() => setPreview(null)}
            >
              Try again
            </Button>
          ) : null}
          {preview ? (
            <Button disabled={pending || !selected.size} type="button" onClick={() => void apply()}>
              Apply selected labels
            </Button>
          ) : (
            <Button
              disabled={pending || targets.length === 0}
              type="button"
              onClick={() => void generate()}
            >
              <Sparkles />
              {pending ? "Analyzing…" : "Create preview"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
