'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowLeft, Check, GitMerge, X, Undo2, AlertTriangle, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { keepTopic, rejectTopic, mergeTopic, reproposeTopic } from '@/lib/actions/sujets';

export interface TriageCard {
  id: string;
  label: string;
  nicheId: string;
  nicheLabel: string;
  nicheColor: string;
  videoCount: number;
  channelCount: number;
  dominantShare: number;
  sampleTitles: { title: string; channel: string }[];
  sensitive: boolean;
  /** sensitive : à décider à la main · ready : publié automatiquement cette nuit · waiting : manque de données. */
  status: 'sensitive' | 'ready' | 'waiting';
  statusReason: string;
}

type Decision = { id: string; kind: 'keep' | 'reject' | 'merge' };

/**
 * Console d'admin · validation des sujets proposés par la collecte, carte par carte.
 * G garder (publié pour tous les clients), F fusionner, R rejeter ; ⌘Z annule « garder » ou « rejeter ».
 */
export function TriageDeck({
  cards,
  mergeTargets,
  view,
  counts,
}: {
  cards: TriageCard[];
  mergeTargets: { id: string; label: string; nicheId: string }[];
  view: 'decider' | 'attente';
  counts: { decide: number; waiting: number; ready: number };
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<Decision[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergeQuery, setMergeQuery] = useState('');
  const [pending, startTransition] = useTransition();
  const card = cards[index];
  const done = index >= cards.length;

  const targets = useMemo(() => {
    if (!card) return [];
    const q = mergeQuery.trim().toLowerCase();
    return mergeTargets
      .filter((t) => t.nicheId === card.nicheId && t.id !== card.id && (!q || t.label.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [card, mergeQuery, mergeTargets]);

  function decide(kind: Decision['kind'], target?: string) {
    if (kind === 'merge' && !target) return;
    if (!card || pending) return;
    startTransition(async () => {
      const res =
        kind === 'keep' ? await keepTopic(card.id) : kind === 'reject' ? await rejectTopic(card.id) : await mergeTopic(card.id, target!);
      if ('error' in res && res.error) {
        toast.error(res.error);
        return;
      }
      setHistory((h) => [...h, { id: card.id, kind }]);
      setMerging(false);
      setMergeQuery('');
      setIndex((i) => i + 1);
      if (kind === 'merge') toast('Sujets fusionnés', { description: 'Les vidéos ont rejoint le sujet choisi.' });
    });
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last || pending) return;
    if (last.kind === 'merge') {
      toast('Une fusion ne peut pas être annulée ici', { description: 'Tu peux défaire la fusion depuis la fiche du sujet.' });
      return;
    }
    startTransition(async () => {
      const res = await reproposeTopic(last.id);
      if ('error' in res && res.error) {
        toast.error(res.error);
        return;
      }
      setHistory((h) => h.slice(0, -1));
      setIndex((i) => Math.max(0, i - 1));
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        if (e.key === 'Escape') setMerging(false);
        return;
      }
      if (merging) {
        if (e.key === 'Escape') setMerging(false);
        return;
      }
      if (e.key === 'g') decide('keep');
      else if (e.key === 'r') decide('reject');
      else if (e.key === 'f') setMerging(true);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const progress = cards.length ? Math.round((Math.min(index, cards.length) / cards.length) * 100) : 100;
  const remaining = Math.max(0, cards.length - index);
  // Compteurs des onglets, mis à jour au fil des décisions de cette session.
  const decideLeft = view === 'decider' ? remaining : counts.decide;
  const waitingLeft = view === 'attente' ? remaining : counts.waiting;
  const kept = history.filter((h) => h.kind === 'keep').length;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5 px-4 py-6 md:py-10">
      <div className="flex items-center gap-3">
        <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Console
        </Link>
        <div className="flex-1" />
        <span className="text-[13px] tabular-nums text-muted-foreground" aria-live="polite">
          {cards.length === 0 ? '' : done ? 'Tout est trié' : `${remaining} restant${remaining > 1 ? 's' : ''} · sujet ${index + 1} sur ${cards.length}`}
        </span>
      </div>

      <nav aria-label="Sujets proposés" className="well grid grid-cols-2 gap-1 rounded-[12px] bg-muted/60 p-1">
        {[
          { key: 'decider', href: '/admin/sujets', label: 'À décider', n: decideLeft, hint: 'sujets sensibles, jamais publiés sans toi' },
          { key: 'attente', href: '/admin/sujets?vue=attente', label: 'En attente du robot', n: waitingLeft, hint: 'publiés seuls dès 5 vidéos de 3 chaînes' },
        ].map((t) => {
          const active = view === t.key;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              title={t.hint}
              className={`flex flex-col rounded-[9px] px-3 py-2 transition-colors ${active ? 'elev-1 bg-card' : 'hover:bg-card/60'}`}
            >
              <span className="flex items-center gap-2 text-[14px] font-medium">
                {t.label}
                <span className={`rounded-full px-1.5 text-[12px] font-semibold tabular-nums ${active ? 'bg-primary-soft text-primary-ink' : 'bg-card text-muted-foreground'}`}>{t.n}</span>
              </span>
              <span className="text-[12px] text-muted-foreground">{t.hint}</span>
            </Link>
          );
        })}
      </nav>

      {view === 'attente' && counts.ready > 0 && !done && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary-ink" aria-hidden="true" />
          {counts.ready} sujet{counts.ready > 1 ? 's remplissent' : ' remplit'} déjà les critères et {counts.ready > 1 ? 'seront publiés' : 'sera publié'} cette nuit. Trier ici est facultatif.
        </p>
      )}
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label="Avancement du tri"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.section
            key="done"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm"
          >
            <CheckCircle2 className="h-10 w-10 text-phase-2" aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-[-0.01em]">{cards.length === 0 ? (view === 'decider' ? 'Rien à décider' : 'Rien en attente') : 'Tri terminé'}</h1>
            <p className="max-w-md text-[15px] text-muted-foreground">
              {cards.length === 0
                ? view === 'decider'
                  ? `Aucun sujet sensible. Les ${counts.waiting} autres sujets proposés sont gérés par le robot : publiés seuls dès 5 vidéos de 3 chaînes.`
                  : 'Aucun sujet en attente de données.'
                : `${kept} sujet${kept > 1 ? 's' : ''} gardé${kept > 1 ? 's' : ''}. Ils apparaîtront chez les clients après le prochain calcul de potentiel.`}
            </p>
            {view === 'decider' && counts.waiting > 0 && (
              <Link href="/admin/sujets?vue=attente" className="text-sm font-medium text-primary">
                Voir les {counts.waiting} sujets en attente du robot
              </Link>
            )}
            <button type="button" onClick={() => router.push('/admin')} className="mt-2 inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground">
              Revenir à la console
            </button>
          </motion.section>
        ) : (
          <motion.article
            key={card.id}
            initial={reduce ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? undefined : { opacity: 0, x: -24 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm md:p-7"
            aria-labelledby="tri-titre"
          >
            <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: card.nicheColor }} aria-hidden="true" />
              Nouveau sujet · {card.nicheLabel}
            </span>
            <h1 id="tri-titre" className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{card.label}</h1>
            <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              <span><strong className="text-foreground">{card.videoCount}</strong> vidéo{card.videoCount > 1 ? 's' : ''}</span>
              <span><strong className="text-foreground">{card.channelCount}</strong> chaîne{card.channelCount > 1 ? 's' : ''}</span>
            </p>

            {card.sampleTitles.length > 0 && (
              <ul className="flex flex-col gap-1.5 rounded-xl bg-background px-4 py-3">
                {card.sampleTitles.map((v, i) => (
                  <li key={i} className="flex flex-col text-sm">
                    <span className="font-medium">{v.title}</span>
                    {v.channel && <span className="text-xs text-muted-foreground">{v.channel}</span>}
                  </li>
                ))}
              </ul>
            )}

            <p
              className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] ${
                card.status === 'sensitive' ? 'bg-phase-1-soft text-phase-1-ink' : card.status === 'ready' ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-muted-foreground'
              }`}
            >
              {card.status === 'sensitive' ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              ) : card.status === 'ready' ? (
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {card.status === 'sensitive' ? 'Sujet sensible : s’il est gardé, il restera exclu des recommandations des clients.' : card.statusReason}
                {card.status !== 'sensitive' && card.dominantShare >= 60 && ` Une seule chaîne publie ${card.dominantShare} % des vidéos : vérifie qu’il ne s’agit pas d’un format propre à elle.`}
              </span>
            </p>

            <p className="text-sm text-muted-foreground">Est-ce un vrai sujet, distinct de ceux qui existent déjà ? Si oui, garde-le : il sera visible par tous les clients qui suivent cette niche.</p>

            {merging ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Fusionner avec quel sujet ?
                  <input
                    autoFocus
                    type="search"
                    value={mergeQuery}
                    onChange={(e) => setMergeQuery(e.target.value)}
                    placeholder="Chercher un sujet de la même niche"
                    className="h-10 rounded-[10px] border border-input bg-card px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </label>
                <ul className="max-h-60 overflow-y-auto rounded-[10px] border border-border">
                  {targets.length ? (
                    targets.map((t) => (
                      <li key={t.id} className="border-b border-muted last:border-b-0">
                        <button type="button" disabled={pending} onClick={() => decide('merge', t.id)} className="w-full px-3 py-2.5 text-left text-sm hover:bg-muted">
                          {t.label}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="px-3 py-3 text-sm text-muted-foreground">Aucun sujet trouvé dans cette niche.</li>
                  )}
                </ul>
                <button type="button" onClick={() => setMerging(false)} className="self-start text-sm font-medium text-primary">Annuler</button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5">
                <button type="button" disabled={pending} onClick={() => decide('keep')} className="flex h-[52px] items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-medium text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60">
                  <Check className="h-4 w-4" aria-hidden="true" /> Garder <kbd className="rounded bg-white/20 px-1.5 font-mono text-[11px]">G</kbd>
                </button>
                <button type="button" disabled={pending} onClick={() => setMerging(true)} className="flex h-[52px] items-center justify-center gap-2 rounded-xl border border-border bg-card text-[15px] font-medium transition-transform hover:bg-muted active:scale-[0.98]">
                  <GitMerge className="h-4 w-4" aria-hidden="true" /> Fusionner <kbd className="rounded border border-border px-1.5 font-mono text-[11px]">F</kbd>
                </button>
                <button type="button" disabled={pending} onClick={() => decide('reject')} className="flex h-[52px] items-center justify-center gap-2 rounded-xl border border-border bg-card text-[15px] font-medium transition-transform hover:bg-muted active:scale-[0.98]">
                  <X className="h-4 w-4" aria-hidden="true" /> Rejeter <kbd className="rounded border border-border px-1.5 font-mono text-[11px]">R</kbd>
                </button>
              </div>
            )}
          </motion.article>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={undo}
        disabled={!history.length || pending}
        className="inline-flex items-center gap-1.5 self-center text-sm font-medium text-primary disabled:text-muted-foreground"
      >
        <Undo2 className="h-4 w-4" aria-hidden="true" /> Annuler le dernier choix (⌘Z)
      </button>
    </div>
  );
}
