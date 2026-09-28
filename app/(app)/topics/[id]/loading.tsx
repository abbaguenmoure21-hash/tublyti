import { Skeleton } from '@/components/ui/skeleton';

export default function TopicLoading() {
  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-80" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-28 rounded-full" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
