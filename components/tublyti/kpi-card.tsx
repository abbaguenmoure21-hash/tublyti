import { Card, CardContent } from '@/components/ui/card';

export function KpiCard({
  icon,
  value,
  label,
  iconClassName,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  iconClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center justify-center w-9 h-9 rounded-lg ${iconClassName ?? 'bg-primary-soft text-primary-ink'}`}
          >
            {icon}
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
