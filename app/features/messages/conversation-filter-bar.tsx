import { X } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import type { MailLabel } from "@/features/organization/types";
import { type ConversationFilters, createEmptyConversationFilters } from "./conversation-filters";

export function ConversationFilterBar({
  activeLabelId,
  filters,
  labels,
  onChange,
  onLabelChange
}: {
  activeLabelId: string | null;
  filters: ConversationFilters;
  labels: MailLabel[];
  onChange: (filters: ConversationFilters) => void;
  onLabelChange: (labelId: string | null) => void;
}): React.ReactElement | null {
  const chips = filterChips(filters, activeLabelId, labels);
  if (chips.length === 0) return null;

  const clearField = (field: keyof ConversationFilters): void => {
    onChange({ ...filters, [field]: emptyValueFor(field) });
  };

  return (
    <section
      aria-label="Active conversation filters"
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-background/80 px-3 py-2"
    >
      {chips.map((chip) => (
        <span
          className="inline-flex h-11 md:h-7 max-w-full items-center gap-1 rounded-full border bg-card pl-2.5 pr-1 text-[11px] text-foreground shadow-sm"
          key={chip.key}
        >
          <span className="truncate">{chip.label}</span>
          <button
            aria-label={`Remove filter: ${chip.label}`}
            className="grid size-11 md:size-5 shrink-0 place-content-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
            onClick={() => (chip.key === "label" ? onLabelChange(null) : clearField(chip.key))}
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      <Button
        className="h-7 px-2 text-[11px]"
        type="button"
        variant="ghost"
        onClick={() => {
          onChange(createEmptyConversationFilters());
          onLabelChange(null);
        }}
      >
        Clear all
      </Button>
    </section>
  );
}

type FilterChip = {
  key: keyof ConversationFilters | "label";
  label: string;
};

function filterChips(
  filters: ConversationFilters,
  activeLabelId: string | null,
  labels: MailLabel[]
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.contains) chips.push({ key: "contains", label: `Contains: ${filters.contains}` });
  if (filters.exclude) chips.push({ key: "exclude", label: `Excludes: ${filters.exclude}` });
  if (filters.from) chips.push({ key: "from", label: `From: ${filters.from}` });
  if (filters.to) chips.push({ key: "to", label: `To: ${filters.to}` });
  if (filters.subject) chips.push({ key: "subject", label: `Subject: ${filters.subject}` });
  if (filters.after) chips.push({ key: "after", label: `From: ${filters.after}` });
  if (filters.before) chips.push({ key: "before", label: `Through: ${filters.before}` });
  if (filters.direction !== "any") {
    chips.push({ key: "direction", label: filters.direction === "inbound" ? "Received" : "Sent" });
  }
  if (filters.read !== "any") {
    chips.push({ key: "read", label: filters.read === "unread" ? "Unread" : "Read" });
  }
  if (filters.starred !== "any") {
    chips.push({
      key: "starred",
      label: filters.starred === "starred" ? "Starred" : "Not starred"
    });
  }
  if (filters.attachments !== "any") {
    chips.push({
      key: "attachments",
      label: filters.attachments === "with" ? "Has attachments" : "No attachments"
    });
  }
  if (activeLabelId) {
    const label = labels.find((candidate) => candidate.id === activeLabelId);
    chips.push({ key: "label", label: `Label: ${label?.name ?? "Selected"}` });
  }
  return chips;
}

function emptyValueFor<Key extends keyof ConversationFilters>(
  field: Key
): ConversationFilters[Key] {
  return emptyConversationFieldValues[field];
}

const emptyConversationFieldValues: ConversationFilters = createEmptyConversationFilters();
