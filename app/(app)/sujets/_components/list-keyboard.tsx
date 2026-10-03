'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { sujetsHref, type SujetsParams } from './url';

/**
 * Raccourcis de la liste (ERGONOMIE.md, règle 6) :
 * J / ↓ sujet suivant · K / ↑ précédent · Entrée ouvrir le premier · Échap fermer le panneau.
 * C et X sont gérés par le panneau (créer / ignorer).
 */
export function ListKeyboard({ ids, params }: { ids: string[]; params: SujetsParams }) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;

      const index = params.sujet ? ids.indexOf(params.sujet) : -1;
      const go = (i: number) => {
        const id = ids[Math.max(0, Math.min(ids.length - 1, i))];
        if (!id) return;
        router.replace(sujetsHref(params, { sujet: id }), { scroll: false });
        requestAnimationFrame(() => document.getElementById(`sujet-${id}`)?.scrollIntoView({ block: 'nearest' }));
      };

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        go(index <= 0 ? 0 : index - 1);
      } else if (e.key === 'Enter' && index === -1) {
        e.preventDefault();
        go(0);
      } else if (e.key === 'Escape' && params.sujet) {
        e.preventDefault();
        router.replace(sujetsHref(params, { sujet: null }), { scroll: false });
        requestAnimationFrame(() => document.getElementById(`sujet-${params.sujet}`)?.focus());
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ids, params, router]);

  return null;
}
