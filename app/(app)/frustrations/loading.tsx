import { Skeleton } from '@/components/ui/skeleton';

/** Same shape as Questions du public: header, view tabs, grid of group cards. */
export default function FrustrationsLoading() {
  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-4 pb-12 pt-5 md:px-8" aria-busy="true" aria-label="Chargement des questions du public">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full max-w-[340px] md:h-9" />
        <Skeleton className="h-4 w-full max-w-[620px]" />
      </div>
      <Skeleton className="h-[38px] w-full max-w-[460px] rounded-[12px]" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[180px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
