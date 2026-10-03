"use client";

// Merchant Brain: command menu (⌘K / Ctrl+K).
//
// This navigates to real screens. It is not a pretend assistant: every entry
// is a route that exists, so the palette cannot promise something the product
// cannot do. Merchant quick-phrases like "show overdue customers" are a
// Business Brain concern and belong there, once the backend can answer them.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";

import { NAV_GROUPS, type NavItem } from "./nav-config";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // ⌘K on Mac, Ctrl+K elsewhere. Registered on the document so it works from
  // anywhere, including from inside a dialog.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setOpen((previous) => !previous);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // The shortcut is named rather than platform-detected: reading
        // `navigator` during render would differ between server and client, and
        // detecting it in an effect would cost an extra render for a label.
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
      >
        <Search aria-hidden="true" className="size-4" />
        <span>Search screens</span>
        <kbd className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
          &#8984;K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Go to a screen"
        description="Search Merchant Brain's screens with ⌘K or Ctrl+K. Your business figures are not searched here."
      >
        {/* `CommandDialog` renders a Dialog, not a cmdk store. Without this
            wrapper, `CommandInput` and `CommandList` have no store to read and
            the palette crashes the moment it opens. */}
        <Command>
          <CommandInput placeholder="Search screens…" />
          <CommandList className="overscroll-contain">
            <CommandEmpty>
              No screen matches that. Try &ldquo;cash&rdquo; or &ldquo;stock&rdquo;.
            </CommandEmpty>
            {NAV_GROUPS.map((group) => (
              <CommandGroup key={group.id} heading={group.label}>
                {group.items.map((item) => (
                  <CommandRow
                    key={item.href}
                    item={item}
                    onSelect={() => {
                      // Order matters. Closing the dialog first unmounts this
                      // component before the router's transition commits, and
                      // the navigation is silently dropped — the palette closes
                      // and the page does not change. Navigate, then close.
                      router.push(item.href);
                      setOpen(false);
                    }}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

function CommandRow({
  item,
  onSelect,
}: {
  readonly item: NavItem;
  readonly onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <CommandItem
      value={`${item.label} ${item.description} ${item.href}`}
      onSelect={onSelect}
    >
      <Icon aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{item.label}</span>
        <span className="truncate text-xs text-muted-foreground">
          {item.description}
        </span>
      </span>
      <CornerDownLeft aria-hidden="true" className="size-3.5 text-muted-foreground" />
    </CommandItem>
  );
}