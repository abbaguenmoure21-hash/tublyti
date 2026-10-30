import { Skeleton } from '@/components/ui/skeleton';

/** Same shape as /sujets: header, search + filters, list of 8 rows. */
export default function SujetsLoading() {
  return (
    <div className="flex min-h-full" aria-busy="true" aria-label="Chargement des sujets">
      <div className="flex min-w-0 flex-1 flex-col gap-5 px-4 pb-10 pt-5 md:px-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full max-w-[420px] md:h-9" />
          <Skeleton className="h-4 w-full max-w-[360px]" />
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Skeleton className="h-9 w-full rounded-[10px] lg:w-64" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-[38px] w-full max-w-[460px] rounded-[12px]" />
            <Skeleton className="h-8 w-36 rounded-full" />
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden h-[37px] border-b border-border bg-background md:block" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-muted px-4 py-3.5 last:border-b-0 md:grid-cols-[32px_minmax(0,1fr)_140px_116px_132px_20px] md:px-5"
            >
              <Skeleton className="hidden h-4 w-4 md:block" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="col-span-2 h-2 w-24 md:col-span-1" />
              <Skeleton className="hidden h-3 w-20 md:block" />
              <span className="hidden md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
