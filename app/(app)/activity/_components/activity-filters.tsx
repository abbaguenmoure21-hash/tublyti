'use client';

import { useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { Filter, ChevronDown, X } from 'lucide-react';

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
  { value: '0-10000', label: '< 10 k abo.' },
  { value: '10000-50000', label: '10–50 k abo.' },
  { value: '50000-250000', label: '50–250 k abo.' },
  { value: '250000-', label: '> 250 k abo.' },
];

export function ActivityFilters({ niches }: { niches: Niche[] }) {
  const [isOpen, setIsOpen] = useState(false);

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

  const activeFiltersCount = (eventType ? 1 : 0) + (nicheId ? 1 : 0) + (channelSize ? 1 : 0);

  const clearFilters = () => {
    setEventType(null);
    setNicheId(null);
    setChannelSize(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-2 h-[36px] px-4 rounded-xl text-[13px] font-bold transition-all border shadow-sm ${
            isOpen || activeFiltersCount > 0
              ? 'bg-white dark:bg-white/10 border-black/10 dark:border-white/20 text-foreground'
              : 'bg-white/60 dark:bg-white/5 border-black/5 dark:border-white/10 text-muted-foreground hover:text-foreground hover:bg-white dark:hover:bg-white/10'
          }`}
        >
          <Filter className="w-4 h-4" />
          <span>Filtres {activeFiltersCount > 0 && `(${activeFiltersCount})`}</span>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {activeFiltersCount > 0 && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 h-[36px] px-3 rounded-xl text-[12px] font-bold text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors border border-destructive/20"
          >
            <X className="w-3.5 h-3.5" />
            Réinitialiser
          </button>
        )}
      </div>

      {isOpen && (
        <div className="flex flex-col gap-3 p-4 rounded-2xl bg-white/60 dark:bg-white/5 border border-black/5 dark:border-white/10 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
        {/* Ligne 1: Types d'événements */}
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-muted-foreground w-[110px] shrink-0">Événements</span>
          <div className="flex items-center gap-2 flex-wrap">
            {EVENT_TYPES.map((t) => {
              const active = eventType === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setEventType(active ? null : t.value)}
                  className={`haptic-btn whitespace-nowrap shrink-0 h-[32px] px-4 rounded-full text-[13px] font-bold transition-all cursor-pointer shadow-sm border ${
                    active
                      ? 'bg-gradient-to-b from-primary to-blue-600 text-primary-foreground border-primary/20 shadow-[0_2px_8px_rgba(10,132,255,0.4)]'
                      : 'bg-white dark:bg-white/10 border-black/5 dark:border-white/10 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/20'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Ligne 2: Niches */}
        {niches.length > 1 && (
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold text-muted-foreground w-[110px] shrink-0">Niches</span>
            <div className="flex items-center gap-2 flex-wrap">
              {niches.map((n) => {
                const active = nicheId === n.id;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setNicheId(active ? null : n.id)}
                    className={`haptic-btn whitespace-nowrap shrink-0 h-[32px] px-4 rounded-full text-[13px] font-bold transition-all cursor-pointer shadow-sm border ${
                      active
                        ? 'bg-gradient-to-b from-primary to-blue-600 text-primary-foreground border-primary/20 shadow-[0_2px_8px_rgba(10,132,255,0.4)]'
                        : 'bg-white dark:bg-white/10 border-black/5 dark:border-white/10 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/20'
                    }`}
                  >
                    {n.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Ligne 3: Taille */}
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-muted-foreground w-[110px] shrink-0">Taille de chaîne</span>
          <div className="flex items-center gap-2 flex-wrap">
            {CHANNEL_SIZES.map((s) => {
              const active = channelSize === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setChannelSize(active ? null : s.value)}
                  className={`haptic-btn whitespace-nowrap shrink-0 h-[32px] px-4 rounded-full text-[13px] font-bold transition-all cursor-pointer shadow-sm border ${
                    active
                      ? 'bg-gradient-to-b from-primary to-blue-600 text-primary-foreground border-primary/20 shadow-[0_2px_8px_rgba(10,132,255,0.4)]'
                      : 'bg-white dark:bg-white/10 border-black/5 dark:border-white/10 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/20'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
