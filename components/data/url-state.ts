"use client";

// Merchant Brain: URL-backed view state.
//
// Filters, search, tabs and pagination live in the URL, not in component state.
// A merchant can therefore bookmark "overdue receivables, page 2", share it,
// and use the browser's back button the way they expect. It also means a
// refresh never silently resets what they were looking at.
//
// Only non-sensitive view state goes here. Tenant identity, tokens and any
// business record never touch a URL.

import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface UrlStateApi {
  readonly params: URLSearchParams;
  /** Reads one parameter. */
  get: (key: string) => string | null;
  /** Writes one parameter. `null` removes it, keeping URLs clean. */
  set: (key: string, value: string | null) => void;
  /** Writes several parameters at once. */
  setMany: (values: Readonly<Record<string, string | null>>) => void;
  /** Drops every parameter and returns to page 1. */
  clear: () => void;
  readonly isPending: boolean;
}

export function useUrlState(): UrlStateApi {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setMany = useCallback(
    (values: Readonly<Record<string, string | null>>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === "") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      const query = next.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  return useMemo<UrlStateApi>(
    () => ({
      params: searchParams,
      get: (key) => searchParams.get(key),
      set: (key, value) => setMany({ [key]: value }),
      setMany,
      clear: () => setMany({}),
      isPending,
    }),
    [isPending, searchParams, setMany],
  );
}
