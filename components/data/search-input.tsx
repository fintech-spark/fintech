"use client";

// Merchant Brain: search input.
//
// Typing is cheap; the request is not. Input is uncontrolled so every
// keystroke does not re-render the page, the value is pushed to the URL after a
// short idle, and the URL is the only thing that ever triggers a fetch.
//
// Merchant-facing affordances: a clear button, a no-results message, and a
// visible label rather than a placeholder doing a label's job.

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 350;

export interface SearchInputProps {
  /** Current value, usually read from the URL. */
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly placeholder?: string;
  /** Accessible label. Always rendered; placeholders are examples only. */
  readonly label: string;
  readonly isSearching?: boolean;
  readonly className?: string;
  readonly autoFocus?: boolean;
}

export function SearchInput({
  value,
  onValueChange,
  placeholder = "Search…",
  label,
  isSearching = false,
  className,
  autoFocus = false,
}: SearchInputProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // `value` (the URL) is the source of truth. `draft` is only ever ahead of it
  // while the merchant is typing. When the URL changes from elsewhere — the
  // back button, a "clear filters" link, the command palette — the draft is
  // reconciled during render rather than in an effect, which avoids the extra
  // render pass an effect would cost on every keystroke.
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onValueChange(draft), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, onValueChange, value]);

  // "/" focuses search, the convention merchants already know from every other
  // tool. Ignored while typing in a field so it never steals a character.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const hasValue = draft.length > 0;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          ref={inputRef}
          type="search"
          value={draft}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && hasValue) {
              event.preventDefault();
              setDraft("");
              onValueChange("");
            }
          }}
          className="pr-16 pl-8"
          // The spinner is decorative; the count is announced separately.
          aria-describedby={isSearching ? `${id}-status` : undefined}
        />
        <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
          {isSearching ? (
            <Loader2
              aria-hidden="true"
              className="size-3.5 animate-spin text-muted-foreground"
            />
          ) : null}
          {hasValue ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => {
                setDraft("");
                onValueChange("");
                inputRef.current?.focus();
              }}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
      <span id={`${id}-status`} className="sr-only" aria-live="polite">
        {isSearching ? "Searching…" : ""}
      </span>
    </div>
  );
}