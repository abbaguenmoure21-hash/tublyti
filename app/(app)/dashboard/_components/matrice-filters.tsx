'use client';

import { useQueryState, parseAsString, parseAsBoolean, parseAsInteger } from 'nuqs';
import { Bookmark, Sparkles, Waves, Shield, LayoutGrid } from 'lucide-react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

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

  // Determine which channels to show in the static tab list
  const staticCount = 3;
  let visibleChannels = channels.slice(0, staticCount);
  
  if (selectedNiche && !visibleChannels.find((c) => c.nicheId === selectedNiche)) {
    const selectedChannel = channels.find((c) => c.nicheId === selectedNiche);
    if (selectedChannel) {
      // Replace the last visible slot with the selected one
      visibleChannels = [...channels.slice(0, staticCount - 1), selectedChannel];
    }
  }

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
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2">
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.015em] text-foreground">
            Où sont les océans bleus ?
          </h1>
          <p className="text-[15px] font-medium text-muted-foreground/80">
            En haut à gauche : demande massive, presque aucune vidéo de qualité.
          </p>
        </div>

        {/* Channel tabs — premium segment control */}
        <div className="flex items-center gap-2 max-w-full flex-wrap">
          <div
            role="tablist"
            aria-label="Chaîne"
            className="relative flex flex-wrap p-1 gap-1 bg-black/5 dark:bg-white/5 backdrop-blur-xl rounded-[14px] border border-black/5 dark:border-white/5 shadow-inner"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!selectedNiche}
              onClick={() => setSelectedNiche(null)}
              className={`relative z-10 h-[34px] px-4 rounded-[10px] text-[13px] font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
                !selectedNiche
                  ? 'bg-white dark:bg-[#1C1C1E] text-foreground font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-black/5 dark:border-white/10 scale-100'
                  : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 scale-[0.98]'
              }`}
            >
              Tous
            </button>
            {visibleChannels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                role="tab"
                aria-selected={selectedNiche === ch.nicheId}
                onClick={() => setSelectedNiche(selectedNiche === ch.nicheId ? null : ch.nicheId)}
                className={`relative z-10 h-[34px] px-4 rounded-[10px] text-[13px] font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
                  selectedNiche === ch.nicheId
                    ? 'bg-white dark:bg-[#1C1C1E] text-foreground font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-black/5 dark:border-white/10 scale-100'
                    : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 scale-[0.98]'
                }`}
              >
                {ch.title}
              </button>
            ))}
          </div>

          <Dialog>
            <DialogTrigger
              className="flex-shrink-0 h-[42px] px-3.5 flex items-center gap-2 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-foreground rounded-[14px] font-medium text-[13px] transition-colors border border-black/5 dark:border-white/5"
            >
              <LayoutGrid className="w-4 h-4 text-muted-foreground" />
              <span className="hidden sm:inline">Tout voir</span>
            </DialogTrigger>
            <DialogContent className="max-w-2xl bg-white/70 dark:bg-[#08090C]/70 backdrop-blur-2xl border-glass shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
              <DialogHeader>
                <DialogTitle className="text-xl">Toutes les niches</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4 max-h-[60vh] overflow-y-auto pr-2 pb-2">
                <button
                  type="button"
                  onClick={() => setSelectedNiche(null)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    !selectedNiche
                      ? 'bg-black/5 dark:bg-white/10 border-transparent font-bold text-foreground'
                      : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground font-medium'
                  }`}
                >
                  Toutes les niches
                </button>
                {channels.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setSelectedNiche(selectedNiche === ch.nicheId ? null : ch.nicheId)}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      selectedNiche === ch.nicheId
                        ? 'bg-black/5 dark:bg-white/10 border-transparent font-bold text-foreground'
                        : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground font-medium'
                    }`}
                  >
                    {ch.title}
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filter pills — Apple-style capsules with spring animation */}
      <div className="flex items-center gap-2.5 flex-wrap bg-white/40 dark:bg-[#08090C]/40 backdrop-blur-md p-2 rounded-2xl border border-[--glass-border] shadow-sm">
        <FilterPill
          active={blueOcean}
          onClick={() => setBlueOcean(blueOcean ? null : true)}
          activeClass="border-[#30D158]/50 bg-[#30D158]/15 text-[#24a142] dark:text-[#30D158]"
          icon={<Waves className="w-3.5 h-3.5" />}
        >
          Océan bleu
        </FilterPill>

        <FilterPill
          active={favFilter}
          onClick={() => setFavFilter(favFilter ? null : true)}
          activeClass="border-primary/50 bg-primary/15 text-primary"
          icon={<Bookmark className="w-3.5 h-3.5" fill={favFilter ? 'currentColor' : 'none'} />}
        >
          Favoris
        </FilterPill>

        <FilterPill
          active={feasibleOnly}
          onClick={() => setFeasibleOnly(feasibleOnly ? null : true)}
          activeClass="border-[#30D158]/50 bg-[#30D158]/15 text-[#24a142] dark:text-[#30D158]"
          icon={<Shield className="w-3.5 h-3.5" />}
        >
          A–B seulement
        </FilterPill>

        <span className="w-px h-6 bg-[--glass-border] mx-1.5" />

        {PHASES.map((p) => {
          const active = phaseFilter === p.value;
          return (
            <FilterPill
              key={p.value}
              active={active}
              onClick={() => setPhaseFilter(active ? null : p.value)}
              activeClass={
                p.value === 0
                  ? 'border-[#5E5CE6]/40 bg-[#5E5CE6]/15 text-[#5E5CE6]'
                  : p.value === 1
                  ? 'border-[#FF9F0A]/40 bg-[#FF9F0A]/15 text-[#d98504] dark:text-[#FF9F0A]'
                  : p.value === 2
                  ? 'border-[#30D158]/40 bg-[#30D158]/15 text-[#24a142] dark:text-[#30D158]'
                  : 'border-[#FF453A]/40 bg-[#FF453A]/15 text-[#d3332a] dark:text-[#FF453A]'
              }
              icon={<span className={`w-2.5 h-2.5 rounded-full ${p.dot} shadow-sm`} />}
            >
              {p.label}
            </FilterPill>
          );
        })}

        <span className="w-px h-6 bg-[--glass-border] mx-1.5" />

        {CHANNEL_SIZES.map((s) => {
          const active = channelSize === s.value;
          return (
            <FilterPill
              key={s.value}
              active={active}
              onClick={() => setChannelSize(active ? null : s.value)}
              activeClass="border-primary/50 bg-primary/15 text-primary"
            >
              {s.label} abo.
            </FilterPill>
          );
        })}

        <div className="flex-1" />
        <span className="text-[12px] font-medium text-muted-foreground/80 px-2">
          Taille du point = score MGI
        </span>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  activeClass,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  activeClass: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 450, damping: 28 }}
      className={`
        h-[34px] px-3.5 rounded-full text-[13px] font-semibold
        transition-all duration-200 cursor-pointer
        flex items-center gap-1.5 shadow-sm
        border
        ${active
          ? activeClass
          : 'border-black/5 dark:border-white/10 bg-white dark:bg-[#1C1C1E] text-foreground hover:bg-black/5 dark:hover:bg-white/5 hover:border-black/10 dark:hover:border-white/20'
        }
      `}
    >
      {icon}
      {children}
    </motion.button>
  );
}
