import { Skeleton } from '@/components/ui/skeleton';

export default function PreflightLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 md:px-8 md:py-8" aria-busy="true" aria-label="Chargement">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="mt-1 h-8 w-80 max-w-full" />
      </div>
      <div className="elev-1 grid gap-6 rounded-[22px] bg-card p-5 md:grid-cols-[1fr_300px] md:p-6">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
        <Skeleton className="aspect-video w-full" />
      </div>
    </div>
  );
}
