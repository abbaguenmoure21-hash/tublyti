import { Skeleton } from '@/components/ui/skeleton';

/** Loading state of the welcome page. */
export default function BienvenueLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-4 py-10 md:py-16" aria-busy="true" aria-label="Chargement">
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="h-14 w-14 rounded-[16px]" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
