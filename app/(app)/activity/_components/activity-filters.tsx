'use client';

import { useQueryState, parseAsString } from 'nuqs';

interface Niche {
  id: string;
  name: string;
}

const EVENT_TYPES = [
  { value: 'new_upload', label: 'Nouvel upload' },
  { value: 'title_change', label: 'Titre modifié' },
  { value: 'thumbnail_change', label: 'Miniature modifiée' },
  { value: 'spike', label: 'Pic de vues' },
];

const CHANNEL_SIZES = [
  { value: '0-10000', label: '< 10 k' },
  { value: '10000-50000', label: '10–50 k' },
  { value: '50000-250000', label: '50–250 k' },
  { value: '250000-', label: '> 250 k' },
];

export function ActivityFilters({ niches }: { niches: Niche[] }) {
  const [eventType, setEventType] = useQueryState(
    'type',
    parseAsString.withDefault('').withOptions({ shallow: false }),
  );
  const [nicheId, setNicheId] = useQueryState(
    'niche',
    parseAsString.withDefault('').withOptions({ shallow: false }),
  );
  const [channelSize, setChannelSize] = useQueryState(
    'chsize',
    parseAsString.withDefault('').withOptions({ shallow: false }),
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Event type filters */}
      {EVENT_TYPES.map((t) => {
        const active = eventType === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => setEventType(active ? null : t.value)}
            className={`h-[30px] px-3 rounded-full text-[13px] font-medium transition-colors cursor-pointer ${
              active
                ? 'border border-primary bg-primary-soft text-primary-ink'
                : 'border border-border bg-card text-foreground hover:bg-muted'
            }`}
          >
            {t.label}
          </button>
        );
      })}

      {niches.length > 1 && (
        <>
          <span className="w-px h-5 bg-border mx-1" />
          {niches.map((n) => {
            const active = nicheId === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setNicheId(active ? null : n.id)}
                className={`h-[30px] px-3 rounded-full text-[13px] font-medium transition-colors cursor-pointer ${
                  active
                    ? 'border border-primary bg-primary-soft text-primary-ink'
                    : 'border border-border bg-card text-foreground hover:bg-muted'
                }`}
              >
                {n.name}
              </button>
            );
          })}
        </>
      )}

      <span className="w-px h-5 bg-border mx-1" />
      {CHANNEL_SIZES.map((s) => {
        const active = channelSize === s.value;
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => setChannelSize(active ? null : s.value)}
            className={`h-[30px] px-3 rounded-full text-[13px] font-medium transition-colors cursor-pointer ${
              active
                ? 'border border-primary bg-primary-soft text-primary-ink'
                : 'border border-border bg-card text-foreground hover:bg-muted'
            }`}
          >
            {s.label} abo.
          </button>
        );
      })}
    </div>
  );
}
