import { Skeleton } from '@/components/ui/skeleton';

export default function TodayLoading() {
  return (
    <div className="flex flex-col min-h-full">
      {/* Top bar skeleton */}
      <header className="h-[60px] shrink-0 flex items-center gap-4 px-6 md:px-8 border-b border-border bg-card">
        <Skeleton className="h-9 w-full max-w-[420px] rounded-lg" />
        <div className="flex-1" />
        <Skeleton className="hidden md:block h-4 w-64" />
      </header>

      <div className="flex-1 p-6 md:px-8 md:py-7 flex flex-col gap-6">
        {/* Title */}
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-5 w-60" />
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-[10px] p-4 flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-16" />
            </div>
          ))}
        </div>

        {/* Channel columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-[10px] flex flex-col">
              <div className="px-[18px] py-3.5 border-b border-border flex justify-between">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-16" />
              </div>
              {[...Array(3)].map((_, j) => (
                <div key={j} className="px-[18px] py-3.5 border-b border-muted flex flex-col gap-2.5 last:border-0">
                  <div className="flex justify-between">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-5 w-8" />
                  </div>
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <div className="flex gap-2">
                    <Skeleton className="h-[30px] w-16 rounded-md" />
                    <Skeleton className="h-[30px] w-24 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Bottom sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-[10px] p-4 flex flex-col gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
