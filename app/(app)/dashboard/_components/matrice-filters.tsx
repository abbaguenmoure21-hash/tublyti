'use client';

import { useQueryState, parseAsString, parseAsBoolean, parseAsInteger } from 'nuqs';
import { Bookmark } from 'lucide-react';

interface Channel {
  id: string;
  title: string;
  nicheId: string;
}

export function MatriceFilters({ channels }: { channels: Channel[] }) {
  const [selectedNiche, setSelectedNiche] = useQueryState(
    'niche',
    parseAsString.withDefault('').withOptions({ shallow: false }),
  );
  const [blueOcean, setBlueOcean] = useQueryState(
    'ocean',
    parseAsBoolean.withDefault(false).withOptions({ shallow: false }),
  );
  const [phaseFilter, setPhaseFilter] = useQueryState(
    'phase',
    parseAsInteger.withDefault(-1).withOptions({ shallow: false }),
  );
  const [favFilter, setFavFilter] = useQueryState(
    'fav',
    parseAsBoolean.withDefault(false).withOptions({ shallow: false }),
  );
  const [channelSize, setChannelSize] = useQueryState(
    'chsize',
    parseAsString.withDefault('').withOptions({ shallow: false }),
  );
  const [feasibleOnly, setFeasibleOnly] = useQueryState(
    'feasible',
    parseAsBoolean.withDefault(false).withOptions({ shallow: false }),
  );

  const CHANNEL_SIZES = [
    { value: '0-10000', label: '< 10 k' },
    { value: '10000-50000', label: '10–50 k' },
    { value: '50000-250000', label: '50–250 k' },
    { value: '250000-', label: '> 250 k' },
  ];

  const PHASES = [
    { value: 0, label: 'Émergence', dot: 'bg-phase-0' },
    { value: 1, label: 'Viralité courte', dot: 'bg-phase-1' },
    { value: 2, label: 'Fenêtre idéale', dot: 'bg-phase-2' },
    { value: 3, label: 'Saturation', dot: 'bg-phase-3' },
  ];

  return (
    <div className="space-y-5">
      {/* Title + channel tabs */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] leading-tight">
            Où sont les océans bleus ?
          </h1>
          <p className="text-[15px] text-muted-foreground">
            En haut à gauche : beaucoup de demande, presque aucune vidéo de qualité.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Chaîne"
          className="flex p-[3px] gap-0.5 bg-muted rounded-[9px]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!selectedNiche}
            onClick={() => setSelectedNiche(null)}
            className={`h-[30px] px-3 rounded-[7px] text-[13px] font-medium transition-colors cursor-pointer ${
              !selectedNiche
                ? 'bg-card text-foreground font-semibold shadow-[0_1px_2px_rgba(20,24,34,0.10)]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Tous
          </button>
          {channels.map((ch) => (
            <button
              key={ch.id}
              type="button"
              role="tab"
              aria-selected={selectedNiche === ch.nicheId}
              onClick={() => setSelectedNiche(selectedNiche === ch.nicheId ? null : ch.nicheId)}
              className={`h-[30px] px-3 rounded-[7px] text-[13px] font-medium transition-colors cursor-pointer ${
                selectedNiche === ch.nicheId
                  ? 'bg-card text-foreground font-semibold shadow-[0_1px_2px_rgba(20,24,34,0.10)]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {ch.title}
            </button>
          ))}
        </div>
      </div>

      {/* Phase filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setBlueOcean(blueOcean ? null : true)}
          className={`h-[30px] px-3 rounded-full text-[13px] font-medium transition-colors cursor-pointer ${
            blueOcean
              ? 'border border-primary bg-primary-soft text-primary-ink'
              : 'border border-border bg-card text-foreground hover:bg-muted'
          }`}
        >
          Océan bleu uniquement
        </button>
        <button
          type="button"
          onClick={() => setFavFilter(favFilter ? null : true)}
          className={`h-[30px] px-3 rounded-full text-[13px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
            favFilter
              ? 'border border-primary bg-primary-soft text-primary-ink'
              : 'border border-border bg-card text-foreground hover:bg-muted'
          }`}
        >
          <Bookmark className="w-3 h-3" fill={favFilter ? 'currentColor' : 'none'} />
          Favoris
        </button>
        <button
          type="button"
          onClick={() => setFeasibleOnly(feasibleOnly ? null : true)}
          className={`h-[30px] px-3 rounded-full text-[13px] font-medium transition-colors cursor-pointer ${
            feasibleOnly
              ? 'border border-success bg-success/10 text-success font-medium'
              : 'border border-border bg-card text-foreground hover:bg-muted'
          }`}
        >
          A–B seulement
        </button>
        <span className="w-px h-5 bg-border mx-1" />
        {PHASES.map((p) => {
          const active = phaseFilter === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setPhaseFilter(active ? null : p.value)}
              className={`h-[30px] px-3 rounded-full text-[13px] flex items-center gap-1.5 transition-colors cursor-pointer ${
                active
                  ? p.value === 2
                    ? 'border border-phase-2 bg-phase-2-soft text-phase-2-ink font-medium'
                    : 'border border-primary bg-primary-soft text-primary-ink font-medium'
                  : 'border border-border bg-card text-foreground hover:bg-muted'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${p.dot}`} />
              {p.label}
            </button>
          );
        })}
        <span className="w-px h-5 bg-border mx-1" />
        {CHANNEL_SIZES.map((s) => {
          const active = channelSize === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setChannelSize(active ? null : s.value)}
              className={`h-[30px] px-3 rounded-full text-[13px] flex items-center gap-1.5 transition-colors cursor-pointer ${
                active
                  ? 'border border-primary bg-primary-soft text-primary-ink font-medium'
                  : 'border border-border bg-card text-foreground hover:bg-muted'
              }`}
            >
              {s.label} abo.
            </button>
          );
        })}
        <div className="flex-1" />
        <span className="text-[13px] text-muted-foreground">Taille du point = frustration exprimée</span>
      </div>
    </div>
  );
}
