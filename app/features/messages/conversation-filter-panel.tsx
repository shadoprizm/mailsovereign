import { CalendarDays, Filter, Mail, Paperclip, Star } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { MailLabel } from "@/features/organization/types";
import {
  activeConversationFilterCount,
  type ConversationFilters,
  conversationFilterDateError,
  createEmptyConversationFilters,
  normalizeConversationFilters,
  recentConversationDateRange
} from "./conversation-filters";

type ConversationFilterPanelProps = {
  activeLabelId: string | null;
  filters: ConversationFilters;
  labels: MailLabel[];
  open: boolean;
  onApply: (filters: ConversationFilters, labelId: string | null) => void;
  onOpenChange: (open: boolean) => void;
};

export function ConversationFilterPanel({
  activeLabelId,
  filters,
  labels,
  open,
  onApply,
  onOpenChange
}: ConversationFilterPanelProps): React.ReactElement {
  const [draft, setDraft] = React.useState<ConversationFilters>(() => ({ ...filters }));
  const [draftLabelId, setDraftLabelId] = React.useState(activeLabelId);
  const fieldPrefix = React.useId();
  const dateError = conversationFilterDateError(draft);

  React.useEffect(() => {
    if (!open) return;
    setDraft({ ...filters });
    setDraftLabelId(activeLabelId);
  }, [activeLabelId, filters, open]);

  function update<Key extends keyof ConversationFilters>(
    key: Key,
    value: ConversationFilters[Key]
  ): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function apply(): void {
    if (dateError) return;
    onApply(normalizeConversationFilters(draft), draftLabelId);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 border-b px-5 pb-4 pt-5 pr-14">
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg border bg-muted/60">
            <Filter aria-hidden="true" className="size-4" />
          </div>
          <SheetTitle>Filter conversations</SheetTitle>
          <SheetDescription className="mt-1 text-sm leading-5 text-muted-foreground">
            Stack any criteria. Every active filter must match.
          </SheetDescription>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <FieldGroup>
            <Field>
              <FieldLabel>Quick filters</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <QuickFilter
                  active={draft.read === "unread"}
                  label="Unread"
                  onClick={() => update("read", draft.read === "unread" ? "any" : "unread")}
                />
                <QuickFilter
                  active={draft.starred === "starred"}
                  icon={<Star aria-hidden="true" />}
                  label="Starred"
                  onClick={() => update("starred", draft.starred === "starred" ? "any" : "starred")}
                />
                <QuickFilter
                  active={draft.attachments === "with"}
                  icon={<Paperclip aria-hidden="true" />}
                  label="Attachments"
                  onClick={() =>
                    update("attachments", draft.attachments === "with" ? "any" : "with")
                  }
                />
                <QuickFilter
                  active={draft.after !== "" || draft.before !== ""}
                  icon={<CalendarDays aria-hidden="true" />}
                  label="Last 7 days"
                  onClick={() =>
                    setDraft((current) => ({ ...current, ...recentConversationDateRange(7) }))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[1, 30].map((days) => (
                  <Button
                    className="h-7 px-2 text-[11px]"
                    key={days}
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        ...recentConversationDateRange(days)
                      }))
                    }
                  >
                    {days === 1 ? "Today" : `Last ${days} days`}
                  </Button>
                ))}
                {draft.after || draft.before ? (
                  <Button
                    className="h-7 px-2 text-[11px]"
                    type="button"
                    variant="ghost"
                    onClick={() => setDraft((current) => ({ ...current, after: "", before: "" }))}
                  >
                    Any time
                  </Button>
                ) : null}
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <FilterInput
                id={`${fieldPrefix}-contains`}
                label="Contains text"
                placeholder="Words or phrase"
                value={draft.contains}
                onChange={(value) => update("contains", value)}
              />
              <FilterInput
                id={`${fieldPrefix}-exclude`}
                label="Doesn't contain"
                placeholder="Exclude words or phrase"
                value={draft.exclude}
                onChange={(value) => update("exclude", value)}
              />
              <FilterInput
                autoComplete="email"
                id={`${fieldPrefix}-from`}
                label="From"
                placeholder="Name, address, or domain"
                value={draft.from}
                onChange={(value) => update("from", value)}
              />
              <FilterInput
                autoComplete="email"
                id={`${fieldPrefix}-to`}
                label="To, Cc, or Bcc"
                placeholder="Name, address, or domain"
                value={draft.to}
                onChange={(value) => update("to", value)}
              />
            </div>

            <FilterInput
              id={`${fieldPrefix}-subject`}
              label="Subject"
              placeholder="Subject contains"
              value={draft.subject}
              onChange={(value) => update("subject", value)}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${fieldPrefix}-after`}>From date</FieldLabel>
                <Input
                  id={`${fieldPrefix}-after`}
                  max={draft.before || undefined}
                  type="date"
                  value={draft.after}
                  onChange={(event) => update("after", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${fieldPrefix}-before`}>Through date</FieldLabel>
                <Input
                  id={`${fieldPrefix}-before`}
                  min={draft.after || undefined}
                  type="date"
                  value={draft.before}
                  onChange={(event) => update("before", event.target.value)}
                />
              </Field>
            </div>
            {dateError ? <FieldError>{dateError}</FieldError> : null}

            <FilterSelect
              id={`${fieldPrefix}-direction`}
              label="Direction"
              value={draft.direction}
              options={[
                ["any", "Any direction"],
                ["inbound", "Received"],
                ["outbound", "Sent"]
              ]}
              onChange={(value) => update("direction", value as ConversationFilters["direction"])}
            />
            <FilterSelect
              id={`${fieldPrefix}-read`}
              label="Read state"
              value={draft.read}
              options={[
                ["any", "Read or unread"],
                ["unread", "Unread"],
                ["read", "Read"]
              ]}
              onChange={(value) => update("read", value as ConversationFilters["read"])}
            />
            <FilterSelect
              id={`${fieldPrefix}-starred`}
              label="Star state"
              value={draft.starred}
              options={[
                ["any", "Starred or unstarred"],
                ["starred", "Starred"],
                ["unstarred", "Not starred"]
              ]}
              onChange={(value) => update("starred", value as ConversationFilters["starred"])}
            />
            <FilterSelect
              id={`${fieldPrefix}-attachments`}
              label="Attachments"
              value={draft.attachments}
              options={[
                ["any", "With or without attachments"],
                ["with", "Has attachments"],
                ["without", "No attachments"]
              ]}
              onChange={(value) =>
                update("attachments", value as ConversationFilters["attachments"])
              }
            />
            <FilterSelect
              id={`${fieldPrefix}-label`}
              label="Label"
              value={draftLabelId ?? "all"}
              options={[
                ["all", "Any label"],
                ...labels.map((label) => [label.id, `${label.name} (${label.conversationCount})`])
              ]}
              onChange={(value) => setDraftLabelId(value === "all" ? null : value)}
            />
          </FieldGroup>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-background px-5 py-4">
          <Button
            disabled={activeConversationFilterCount(draft, draftLabelId) === 0}
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(createEmptyConversationFilters());
              setDraftLabelId(null);
            }}
          >
            Reset
          </Button>
          <Button disabled={Boolean(dateError)} type="button" onClick={apply}>
            Apply filters
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function QuickFilter({
  active,
  icon = <Mail aria-hidden="true" />,
  label,
  onClick
}: {
  active: boolean;
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Button
      aria-pressed={active}
      className="justify-start"
      type="button"
      variant={active ? "secondary" : "outline"}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

function FilterInput({
  id,
  label,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "onChange"> & {
  id: string;
  label: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input {...props} id={id} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function FilterSelect({
  id,
  label,
  onChange,
  options,
  value
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: string[][];
  value: string;
}): React.ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) =>
            optionValue && optionLabel ? (
              <SelectItem key={optionValue} value={optionValue}>
                {optionLabel}
              </SelectItem>
            ) : null
          )}
        </SelectContent>
      </Select>
    </Field>
  );
}
