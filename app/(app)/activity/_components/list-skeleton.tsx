import { Skeleton } from '@/components/ui/skeleton';

/** List-shaped placeholder for the Veille pages: header, tabs, optional KPI tiles, 4 rows. */
export function ListSkeleton({ kpis = false }: { kpis?: boolean }) {
  return (
    <div className="flex flex-col gap-6 px-4 pb-12 pt-5 md:px-8" aria-busy="true" aria-label="Chargement">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full max-w-[420px]" />
        <Skeleton className="h-5 w-full max-w-[560px]" />
      </div>
      {kpis && (
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2 rounded-2xl bg-card px-3 py-3 md:px-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-10" />
            </div>
          ))}
        </div>
      )}
      <Skeleton className="h-10 w-full max-w-[520px] rounded-[12px]" />
      <div className="overflow-hidden rounded-2xl bg-card">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 border-b border-muted px-4 py-4 last:border-b-0 md:px-5">
            <Skeleton className="aspect-video w-[132px] shrink-0 rounded-[10px] md:w-[176px]" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-5 w-full max-w-[480px]" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
