'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown, Search } from 'lucide-react';

export interface SwitcherItem {
  key: string;
  label: string;
  color: string;
  verified: boolean;
}

interface ChannelSwitcherProps {
  items: SwitcherItem[];
  value: string;
  onChange: (key: string) => void;
  /** Barre réduite : bouton rond, menu ouvert à droite. */
  compact?: boolean;
}

const ALL: SwitcherItem = { key: 'all', label: 'Toutes mes chaînes', color: 'var(--foreground)', verified: true };

/**
 * Sélecteur « Afficher » compact : une seule ligne dans la barre, quel que soit le nombre de chaînes.
 * Le menu a une recherche (dès 6 chaînes), une liste qui défile et se pilote au clavier.
 */
export function ChannelSwitcher({ items, value, onChange, compact = false }: ChannelSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const all = useMemo(() => [ALL, ...items], [items]);
  const current = all.find((i) => i.key === value) ?? ALL;
  const showSearch = items.length >= 6;

  const filtered = useMemo(() => {
    const q = query
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (!q) return all;
    return all.filter((i) =>
      i.label
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .includes(q),
    );
  }, [all, query]);

  // Position du menu (fixe, pour ne pas être coupé par la barre qui défile).
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 264;
      const margin = 8;
      if (compact) {
        const top = Math.max(margin, r.top);
        setPos({ top, left: r.right + 10, width, maxHeight: window.innerHeight - top - margin });
      } else {
        const top = r.bottom + 6;
        setPos({ top, left: r.left, width: Math.max(r.width, 224), maxHeight: window.innerHeight - top - margin });
      }
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, compact]);

  // Ouverture : focus sur la recherche, élément courant en surbrillance.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => (showSearch ? inputRef.current : listRef.current)?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, showSearch]);

  // Fermeture au clic extérieur.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Garde l'élément actif visible.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(key: string) {
    setOpen(false);
    buttonRef.current?.focus();
    if (key !== value) onChange(key);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[active];
      if (item) choose(item.key);
    }
  }

  const pendingCount = items.filter((i) => !i.verified).length;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Chaîne affichée : ${current.label}. Changer`}
        title={compact ? `Afficher : ${current.label}` : undefined}
        onClick={() => {
          if (!open) {
            setQuery('');
            setActive(Math.max(0, all.findIndex((i) => i.key === value)));
          }
          setOpen(!open);
        }}
        className={
          compact
            ? `well relative flex h-10 w-10 items-center justify-center rounded-[12px] bg-muted/60 transition-colors hover:bg-muted ${open ? 'ring-2 ring-primary/40' : ''}`
            : `well group flex w-full items-center gap-2.5 rounded-[12px] bg-muted/50 px-2.5 py-2 text-left transition-colors hover:bg-muted ${open ? 'ring-2 ring-primary/40' : ''}`
        }
      >
        {compact ? (
          <>
            <span className="h-3 w-3 rounded-full" style={{ background: current.color }} aria-hidden="true" />
            {pendingCount > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />}
          </>
        ) : (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: current.color }} aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              <span className="text-[10.5px] font-semibold uppercase leading-tight tracking-[0.05em] text-muted-foreground">Afficher</span>
              <span className="truncate text-[13px] font-medium leading-tight text-foreground">{current.label}</span>
            </span>
            <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
          </>
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            onKeyDown={onKeyDown}
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: Math.min(pos.maxHeight, 440) }}
            className="elev-3 fixed z-[70] flex flex-col overflow-hidden rounded-[14px] border border-border bg-card/95 p-1.5 backdrop-blur-2xl animate-in fade-in-0 zoom-in-95"
          >
            <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Afficher</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{items.length} chaîne{items.length > 1 ? 's' : ''}</span>
            </div>
            {showSearch && (
              <label className="mb-1.5 flex h-8 items-center gap-2 rounded-[9px] bg-muted/70 px-2 text-[13px]">
                <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Chercher une chaîne"
                  aria-label="Chercher une chaîne"
                  className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </label>
            )}
            <ul ref={listRef} role="listbox" tabIndex={-1} aria-label="Chaînes" className="-mr-1 flex flex-col gap-0.5 overflow-y-auto pr-1 outline-none">
              {filtered.length === 0 && <li className="px-2 py-3 text-center text-[13px] text-muted-foreground">Aucune chaîne trouvée</li>}
              {filtered.map((i, idx) => {
                const selected = i.key === value;
                return (
                  <li key={i.key} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      data-index={idx}
                      tabIndex={-1}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => choose(i.key)}
                      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors ${
                        idx === active ? 'bg-muted text-foreground' : 'text-muted-foreground'
                      } ${selected ? 'font-medium text-foreground' : ''}`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: i.color }} aria-hidden="true" />
                      <span className="truncate">{i.label}</span>
                      {!i.verified && (
                        <span className="ml-auto shrink-0 rounded-md bg-phase-1-soft px-1.5 text-[10px] font-semibold text-phase-1-ink" title="Chaîne pas encore vérifiée">
                          À vérifier
                        </span>
                      )}
                      {selected && <Check className={`${i.verified ? 'ml-auto' : ''} h-3.5 w-3.5 shrink-0 text-primary-ink`} aria-hidden="true" />}
                    </button>
                    {i.key === 'all' && filtered.length > 1 && <div className="mx-2 my-1 h-px bg-border" aria-hidden="true" />}
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
