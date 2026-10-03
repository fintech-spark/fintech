// Route-level loading for the whole authenticated application.
//
// A skeleton that matches the real page rhythm — header, then a row of
// summary tiles, then a table — so the layout does not jump when data lands.
// Progress percentages are never invented.

import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex w-full max-w-6xl flex-col gap-6"
    >
      <span className="sr-only">Loading your business…</span>

      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-full max-w-prose" />
        </div>
        <Skeleton className="h-10 w-full" />
      </div>

      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-xl" />
        ))}
      </div>

      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
