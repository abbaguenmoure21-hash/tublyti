'use client';

import { useQueryState, parseAsString, parseAsBoolean } from 'nuqs';
import { Button } from '@/components/ui/button';
import { Target } from 'lucide-react';

interface Niche {
  id: string;
  name: string;
}

export function DashboardFilters({ niches }: { niches: Niche[] }) {
  const [selectedNiche, setSelectedNiche] = useQueryState(
    'niche',
    parseAsString.withDefault('').withOptions({ shallow: false }),
  );
  const [blueOcean, setBlueOcean] = useQueryState(
    'ocean',
    parseAsBoolean.withDefault(false).withOptions({ shallow: false }),
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={selectedNiche}
        onChange={(e) => setSelectedNiche(e.target.value || null)}
        className="h-8 rounded-lg border border-input bg-background px-3 text-sm"
      >
        <option value="">Toutes les niches</option>
        {niches.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
      <Button
        variant={blueOcean ? 'default' : 'outline'}
        size="sm"
        onClick={() => setBlueOcean(blueOcean ? null : true)}
        className="cursor-pointer"
      >
        <Target className="w-3.5 h-3.5" />
        Sujets peu traités
      </Button>
    </div>
  );
}
