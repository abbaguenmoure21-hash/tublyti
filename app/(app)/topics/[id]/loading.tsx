import { Skeleton } from '@/components/ui/skeleton';

/** Same shape as the topic page: back link, title + actions, 5 tiles, then 2 columns. */
export default function TopicLoading() {
  return (
    <div className="flex flex-1 flex-col min-w-0" aria-busy="true" aria-label="Chargement du sujet">
      <div className="px-4 pt-5 md:px-8">
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="flex flex-1 flex-col gap-5 px-4 pb-12 pt-3 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="flex min-w-0 flex-col gap-2.5">
            <Skeleton className="h-6 w-56 rounded-full" />
            <Skeleton className="h-8 w-full max-w-[480px] md:h-9" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="h-9 w-40 rounded-lg" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-xl" />
          ))}
        </div>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <Skeleton className="h-[280px] rounded-xl" />
            <Skeleton className="h-[360px] rounded-xl" />
          </div>
          <div className="flex w-full flex-col gap-5 lg:w-[400px] lg:shrink-0">
            <Skeleton className="h-[320px] rounded-xl" />
            <Skeleton className="h-[420px] rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
