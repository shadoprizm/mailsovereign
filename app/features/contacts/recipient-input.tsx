import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

import { listContactSuggestions } from "./api";
import type { ContactSuggestion } from "./types";

type RecipientInputProps = Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function RecipientInput({
  className,
  value,
  onValueChange,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}: RecipientInputProps): React.ReactElement {
  const listId = React.useId();
  const [focused, setFocused] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<ContactSuggestion[]>([]);
  const [highlighted, setHighlighted] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const suppressedValue = React.useRef<string | null>(null);
  const query = recipientQuery(value);

  React.useEffect(() => {
    if (!focused || suppressedValue.current === value) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(
      () => {
        void listContactSuggestions(query)
          .then((items) => {
            if (!active) return;
            setSuggestions(items);
            setHighlighted(0);
          })
          .catch(() => {
            if (active) setSuggestions([]);
          });
      },
      query ? 120 : 0
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [focused, query, value]);

  function selectSuggestion(suggestion: ContactSuggestion): void {
    const nextValue = replaceRecipientSegment(value, suggestion.email);
    suppressedValue.current = nextValue;
    onValueChange(nextValue);
    setSuggestions([]);
    inputRef.current?.focus();
  }

  const expanded = focused && suggestions.length > 0;
  return (
    <div className="relative min-w-0">
      <Input
        {...props}
        aria-activedescendant={expanded ? `${listId}-option-${highlighted}` : undefined}
        aria-autocomplete="list"
        aria-controls={expanded ? listId : undefined}
        aria-expanded={expanded}
        className={className}
        ref={inputRef}
        role="combobox"
        value={value}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onChange={(event) => {
          suppressedValue.current = null;
          onValueChange(event.target.value);
          setHighlighted(0);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || !expanded) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((current) => (current + 1) % suggestions.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((current) => (current - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const suggestion = suggestions[highlighted];
            if (suggestion) selectSuggestion(suggestion);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setSuggestions([]);
          }
        }}
      />
      {expanded ? (
        <div
          className="absolute inset-x-0 top-full z-[70] mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
          id={listId}
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <button
              aria-selected={highlighted === index}
              className={cn(
                "flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left outline-none",
                highlighted === index && "bg-muted"
              )}
              id={`${listId}-option-${index}`}
              key={`${suggestion.source}:${suggestion.email}`}
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => selectSuggestion(suggestion)}
            >
              <span className="min-w-0 flex-1">
                {suggestion.name ? (
                  <span className="block truncate text-sm font-medium">{suggestion.name}</span>
                ) : null}
                <span className="block truncate text-xs text-muted-foreground">
                  {suggestion.email}
                </span>
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {suggestion.source === "contact" ? "Saved" : "Recent"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function recipientQuery(value: string): string {
  const separator = Math.max(value.lastIndexOf(","), value.lastIndexOf("\n"));
  return value
    .slice(separator + 1)
    .trim()
    .slice(0, 40);
}

export function replaceRecipientSegment(value: string, email: string): string {
  const separator = Math.max(value.lastIndexOf(","), value.lastIndexOf("\n"));
  if (separator < 0) return email;
  const prefix = value.slice(0, separator + 1);
  return `${prefix}${/\s$/u.test(prefix) ? "" : " "}${email}`;
}
