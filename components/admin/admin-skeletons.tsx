import { Skeleton } from '@/components/ui/skeleton';

/** Loading shape shared by console pages: title, a summary block, then a table-like list. */
export function AdminPageSkeleton({ rows = 6, summary = true }: { rows?: number; summary?: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8" aria-busy="true" aria-label="Chargement">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      {summary && <Skeleton className="h-28 w-full rounded-xl" />}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-muted px-4 py-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
