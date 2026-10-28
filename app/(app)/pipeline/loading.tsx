import { Skeleton } from '@/components/ui/skeleton';

export default function PipelineLoading() {
  return (
    <div className="flex flex-col gap-4 px-4 pb-8 pt-5 md:px-8" aria-busy="true" aria-label="Chargement de tes vidéos">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-5 w-full max-w-xl" />
      <div className="flex flex-col gap-4 md:flex-row">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-3 md:min-w-[260px] md:flex-1">
            <Skeleton className="h-6 w-32 bg-card" />
            <Skeleton className="h-28 rounded-2xl bg-card" />
            {i < 2 && <Skeleton className="h-28 rounded-2xl bg-card" />}
          </div>
        ))}
      </div>
    </div>
  );
}
