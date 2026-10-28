import { Skeleton } from '@/components/ui/skeleton';

/** Same shape as the Carte: header, segmented filters + toggles, chart with detail card, table. */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6 px-4 pb-12 pt-5 md:px-8" aria-busy="true" aria-label="Chargement de la carte">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full max-w-[360px] md:h-9" />
        <Skeleton className="h-4 w-full max-w-[680px]" />
        <Skeleton className="h-4 w-full max-w-[520px]" />
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Skeleton className="h-[38px] w-full max-w-[520px] rounded-[12px]" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-48 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[200px] rounded-2xl md:h-[420px]" />
        <Skeleton className="h-[360px] rounded-2xl" />
      </div>
      <Skeleton className="h-[320px] rounded-2xl" />
    </div>
  );
}
