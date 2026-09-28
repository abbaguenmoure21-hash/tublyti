'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  Sun,
  ScatterChart,
  Columns3,
  MessageSquareWarning,
  ListChecks,
  Tv,
  SlidersHorizontal,
  Settings,
  Search,
  Sparkles,
  ArrowRight,
  Moon,
  Monitor,
  SunMedium,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { markTopicProduction } from '@/lib/actions/topics';
import { generateAngles } from '@/lib/actions/angles';
import { escapeLike } from '@/lib/utils';

const PAGES = [
  { href: '/today', label: "Aujourd'hui", icon: Sun },
  { href: '/dashboard', label: 'Matrice', icon: ScatterChart },
  { href: '/pipeline', label: 'Pipeline', icon: Columns3 },
  { href: '/frustrations', label: 'Frustrations', icon: MessageSquareWarning },
  { href: '/topics/review', label: 'Validation', icon: ListChecks },
  { href: '/channels', label: 'Chaînes', icon: Tv },
  { href: '/settings', label: 'Réglages', icon: SlidersHorizontal },
  { href: '/admin/jobs', label: 'Jobs', icon: Settings },
];

interface SearchResult {
  id: string;
  label: string;
  type: 'topic' | 'niche' | 'channel';
  extra?: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { setTheme } = useTheme();

  // Open with ⌘K / Ctrl+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Search Supabase when query changes
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const pattern = `%${escapeLike(query)}%`;

      const [topicsRes, nichesRes, channelsRes] = await Promise.all([
        supabase
          .from('topics')
          .select('id, label, niches(name)')
          .ilike('label', pattern)
          .limit(8),
        supabase
          .from('niches')
          .select('id, name')
          .ilike('name', pattern)
          .limit(4),
        supabase
          .from('channels')
          .select('id, title, niches(name)')
          .ilike('title', pattern)
          .limit(4),
      ]);

      if (controller.signal.aborted) return;

      const items: SearchResult[] = [];

      if (topicsRes.data) {
        for (const t of topicsRes.data) {
          items.push({
            id: t.id,
            label: t.label,
            type: 'topic',
            extra: (t.niches as unknown as { name: string } | null)?.name,
          });
        }
      }

      if (nichesRes.data) {
        for (const n of nichesRes.data) {
          items.push({ id: n.id, label: n.name, type: 'niche' });
        }
      }

      if (channelsRes.data) {
        for (const c of channelsRes.data) {
          items.push({
            id: c.id,
            label: c.title,
            type: 'channel',
            extra: (c.niches as unknown as { name: string } | null)?.name,
          });
        }
      }

      setResults(items);
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query]);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery('');
      router.push(href);
    },
    [router],
  );

  function handleAction(action: string, id: string) {
    setOpen(false);
    setQuery('');
    if (action === 'generate-angles') {
      startTransition(async () => {
        const result = await generateAngles(id);
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success('Angles générés.');
          router.push(`/topics/${id}`);
        }
      });
    } else if (action === 'mark-production') {
      startTransition(async () => {
        const result = await markTopicProduction(id);
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success('Sujet marqué en production.');
        }
      });
    }
  }

  function handleTheme(theme: string) {
    setTheme(theme);
    setOpen(false);
    setQuery('');
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery('');
      }}
      label="Palette de commandes"
      className="fixed inset-0 z-50"
      shouldFilter={false}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 supports-backdrop-filter:backdrop-blur-xs"
        onClick={() => setOpen(false)}
        aria-hidden
      />

      {/* Panel */}
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-[min(560px,calc(100vw-32px))] bg-popover border border-border rounded-xl shadow-[0_8px_24px_rgba(20,24,34,0.10)] overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Rechercher un sujet, une chaîne, une page…"
            className="flex-1 h-12 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border px-1.5 text-[10px] font-mono text-muted-foreground">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <Command.List className="max-h-[min(360px,50vh)] overflow-y-auto p-1.5">
          <Command.Empty className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            {isPending ? 'Action en cours…' : 'Aucun résultat.'}
          </Command.Empty>

          {/* Pages */}
          {(!query || query.length < 2) && (
            <Command.Group heading="Pages" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
              {PAGES.map((p) => {
                const Icon = p.icon;
                return (
                  <Command.Item
                    key={p.href}
                    value={p.label}
                    onSelect={() => navigate(p.href)}
                    className="flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] text-foreground cursor-pointer data-[selected=true]:bg-accent transition-colors"
                  >
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    {p.label}
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {/* Theme */}
          {(!query || query.length < 2) && (
            <Command.Group heading="Thème" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
              {[
                { value: 'light', label: 'Thème clair', icon: SunMedium },
                { value: 'dark', label: 'Thème sombre', icon: Moon },
                { value: 'system', label: 'Thème système', icon: Monitor },
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <Command.Item
                    key={t.value}
                    value={t.label}
                    onSelect={() => handleTheme(t.value)}
                    className="flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] text-foreground cursor-pointer data-[selected=true]:bg-accent transition-colors"
                  >
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    {t.label}
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {/* Search results */}
          {results.length > 0 && (
            <>
              {/* Topics */}
              {results.filter((r) => r.type === 'topic').length > 0 && (
                <Command.Group heading="Sujets" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
                  {results
                    .filter((r) => r.type === 'topic')
                    .map((r) => (
                      <Command.Item
                        key={r.id}
                        value={`topic-${r.label}`}
                        onSelect={() => navigate(`/topics/${r.id}`)}
                        className="flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] text-foreground cursor-pointer data-[selected=true]:bg-accent transition-colors"
                      >
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="flex-1 truncate">{r.label}</span>
                        {r.extra && (
                          <span className="text-[11px] text-muted-foreground">{r.extra}</span>
                        )}
                      </Command.Item>
                    ))}
                </Command.Group>
              )}

              {/* Actions on topics */}
              {results.filter((r) => r.type === 'topic').length > 0 && (
                <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
                  {results
                    .filter((r) => r.type === 'topic')
                    .slice(0, 3)
                    .map((r) => (
                      <div key={`actions-${r.id}`}>
                        <Command.Item
                          value={`generate-angles-${r.label}`}
                          onSelect={() => handleAction('generate-angles', r.id)}
                          className="flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] text-foreground cursor-pointer data-[selected=true]:bg-accent transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-primary" />
                          <span className="truncate">Générer des angles pour « {r.label} »</span>
                        </Command.Item>
                        <Command.Item
                          value={`mark-production-${r.label}`}
                          onSelect={() => handleAction('mark-production', r.id)}
                          className="flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] text-foreground cursor-pointer data-[selected=true]:bg-accent transition-colors"
                        >
                          <ArrowRight className="w-3.5 h-3.5 text-phase-2" />
                          <span className="truncate">Marquer en production « {r.label} »</span>
                        </Command.Item>
                      </div>
                    ))}
                </Command.Group>
              )}

              {/* Niches */}
              {results.filter((r) => r.type === 'niche').length > 0 && (
                <Command.Group heading="Niches" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
                  {results
                    .filter((r) => r.type === 'niche')
                    .map((r) => (
                      <Command.Item
                        key={r.id}
                        value={`niche-${r.label}`}
                        onSelect={() => navigate(`/dashboard?niche=${r.id}`)}
                        className="flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] text-foreground cursor-pointer data-[selected=true]:bg-accent transition-colors"
                      >
                        <ScatterChart className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="truncate">{r.label}</span>
                      </Command.Item>
                    ))}
                </Command.Group>
              )}

              {/* Channels */}
              {results.filter((r) => r.type === 'channel').length > 0 && (
                <Command.Group heading="Chaînes" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
                  {results
                    .filter((r) => r.type === 'channel')
                    .map((r) => (
                      <Command.Item
                        key={r.id}
                        value={`channel-${r.label}`}
                        onSelect={() => navigate('/channels')}
                        className="flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] text-foreground cursor-pointer data-[selected=true]:bg-accent transition-colors"
                      >
                        <Tv className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="flex-1 truncate">{r.label}</span>
                        {r.extra && (
                          <span className="text-[11px] text-muted-foreground">{r.extra}</span>
                        )}
                      </Command.Item>
                    ))}
                </Command.Group>
              )}
            </>
          )}

          {/* Add channel action (always visible) */}
          {(!query || query.length < 2) && (
            <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
              <Command.Item
                value="Ajouter une chaîne"
                onSelect={() => navigate('/channels')}
                className="flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] text-foreground cursor-pointer data-[selected=true]:bg-accent transition-colors"
              >
                <Tv className="w-3.5 h-3.5 text-muted-foreground" />
                Ajouter une chaîne
              </Command.Item>
            </Command.Group>
          )}
        </Command.List>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="inline-flex h-4 items-center rounded border border-border px-1 text-[10px] font-mono">↑↓</kbd>
            naviguer
          </span>
          <span className="flex items-center gap-1">
            <kbd className="inline-flex h-4 items-center rounded border border-border px-1 text-[10px] font-mono">↵</kbd>
            sélectionner
          </span>
          <span className="flex items-center gap-1">
            <kbd className="inline-flex h-4 items-center rounded border border-border px-1 text-[10px] font-mono">esc</kbd>
            fermer
          </span>
        </div>
      </div>
    </Command.Dialog>
  );
}
