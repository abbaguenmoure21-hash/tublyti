'use client';

import { useQueryState, parseAsString } from 'nuqs';

export function NicheFilter({ niches }: { niches: string[] }) {
  const [niche, setNiche] = useQueryState(
    'niche',
    parseAsString.withDefault('').withOptions({ shallow: false }),
  );

  return (
    <select
      value={niche}
      onChange={(e) => setNiche(e.target.value || null)}
      aria-label="Filtrer par niche"
      className="h-8 rounded-lg border border-input bg-background px-3 text-sm"
    >
      <option value="">Toutes les niches</option>
      {niches.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
