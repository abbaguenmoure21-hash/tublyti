'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Check } from 'lucide-react';
import { createVideoFromTopic, undoCreateVideo, ignoreTopic, unignoreTopic } from '@/lib/actions/sujets';

interface Props {
  topicId: string;
  topicLabel: string;
  inProduction: boolean;
  angles: { id: string; title: string; hook: string | null }[];
  /** Adresse du sujet suivant (après « Ignorer »), ou de la liste si c'était le dernier. */
  afterIgnoreHref: string;
}

/**
 * Choix d'un angle + action principale « Créer cette vidéo » (C) et action secondaire « Ignorer » (X).
 * Chaque action se défait depuis la notification (règle 8).
 */
export function TopicActions({ topicId, topicLabel, inProduction, angles, afterIgnoreHref }: Props) {
  const router = useRouter();
  const [angleId, setAngleId] = useState<string | null>(angles[0]?.id ?? null);
  const [pending, startTransition] = useTransition();

  function create() {
    if (pending || inProduction) return;
    startTransition(async () => {
      const res = await createVideoFromTopic(topicId, angleId);
      if ('error' in res && res.error) {
        toast.error(res.error);
        return;
      }
      const created = res as { videoId: string; existing?: boolean };
      if (created.existing) {
        toast('Ce sujet est déjà dans Mes vidéos', {
          action: { label: 'Ouvrir', onClick: () => router.push('/pipeline') },
        });
        router.refresh();
        return;
      }
      toast.success('Vidéo ajoutée à Mes vidéos', {
        description: topicLabel,
        // The server actions revalidate /sujets, /pipeline and /topics/[id]: no extra router.refresh().
        action: { label: 'Annuler', onClick: () => void undoCreateVideo(created.videoId) },
        cancel: { label: 'Ouvrir', onClick: () => router.push('/pipeline') },
      });
    });
  }

  function ignore() {
    if (pending) return;
    startTransition(async () => {
      const res = await ignoreTopic(topicId);
      if ('error' in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast('Sujet ignoré', {
        description: topicLabel,
        action: { label: 'Annuler', onClick: () => void unignoreTopic(topicId) },
      });
      router.replace(afterIgnoreHref, { scroll: false });
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && (el as HTMLInputElement).type !== 'radio') return;
      if (e.key === 'c') {
        e.preventDefault();
        create();
      } else if (e.key === 'x') {
        e.preventDefault();
        ignore();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <>
      {angles.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-semibold">Choisis un angle</legend>
          {angles.map((a) => {
            const on = angleId === a.id;
            return (
              <label
                key={a.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-sm leading-snug transition-colors ${
                  on ? 'border-primary bg-primary-soft/60' : 'border-border hover:bg-muted'
                }`}
              >
                <input
                  type="radio"
                  name={`angle-${topicId}`}
                  checked={on}
                  onChange={() => setAngleId(a.id)}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{a.title}</span>
                  {a.hook && <span className="text-[13px] text-muted-foreground">{a.hook}</span>}
                </span>
              </label>
            );
          })}
          <label
            className={`flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-sm transition-colors ${
              angleId === null ? 'border-primary bg-primary-soft/60' : 'border-border hover:bg-muted'
            }`}
          >
            <input type="radio" name={`angle-${topicId}`} checked={angleId === null} onChange={() => setAngleId(null)} className="accent-[var(--primary)]" />
            Je choisirai mon angle plus tard
          </label>
        </fieldset>
      )}

      <div className="sticky bottom-0 -mx-5 mt-auto flex flex-col gap-2 border-t border-border bg-card/95 px-5 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur">
        {inProduction ? (
          <Link
            href="/pipeline"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-muted text-[15px] font-medium text-foreground"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Déjà dans Mes vidéos · Ouvrir
          </Link>
        ) : (
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-medium text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {pending ? 'Création…' : 'Créer cette vidéo'}
            <kbd className="ml-1 rounded bg-white/20 px-1.5 font-mono text-[11px]" aria-hidden="true">C</kbd>
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={`/topics/${topicId}`}
            className="inline-flex h-10 items-center justify-center rounded-[10px] border border-border text-sm font-medium hover:bg-muted"
          >
            Voir la fiche complète
          </Link>
          <button
            type="button"
            onClick={ignore}
            disabled={pending}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Ignorer
            <kbd className="rounded border border-border px-1 font-mono text-[11px]" aria-hidden="true">X</kbd>
          </button>
        </div>
      </div>
    </>
  );
}
