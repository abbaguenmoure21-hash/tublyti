'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface Props {
  position: string;
  prevHref: string | null;
  nextHref: string | null;
  closeHref: string;
  children: React.ReactNode;
}

/**
 * Panneau inspecteur à droite (bureau) ou feuille plein écran (mobile).
 * Non modal : la liste reste utilisable à côté (ERGONOMIE.md, règle 2).
 */
export function Inspector({ position, prevHref, nextHref, closeHref, children }: Props) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);

  // Mobile only: the sheet covers the screen, so move focus into it and make
  // everything behind it inert. Desktop stays non-modal.
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia('(max-width: 767px)').matches) return;
    const touched: HTMLElement[] = [];
    let node: HTMLElement | null = el;
    while (node && node.parentElement && node !== document.body) {
      for (const sib of Array.from(node.parentElement.children)) {
        // Never silence toasts or live regions: they must stay announced and clickable.
        // (sonner renders <section aria-live> in place, next to the app shell)
        const live = sib.matches('[aria-live], [data-sonner-toaster]') || sib.firstElementChild?.matches('[data-sonner-toaster]');
        if (sib !== node && sib instanceof HTMLElement && !sib.inert && !live) {
          sib.inert = true;
          touched.push(sib);
        }
      }
      node = node.parentElement;
    }
    el.focus();
    return () => touched.forEach((s) => (s.inert = false));
  }, []);

  const navBtn =
    'flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-40';

  return (
    <motion.aside
      ref={ref}
      tabIndex={-1}
      aria-label="Aperçu du sujet"
      initial={reduce ? false : { x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      className="fixed inset-0 z-50 flex flex-col bg-card md:elev-3 md:sticky md:inset-auto md:top-2 md:z-auto md:my-2 md:mr-2 md:h-[calc(100vh-16px)] md:w-[440px] md:shrink-0 md:overflow-hidden md:rounded-[22px] outline-none"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
        <span className="text-[13px] text-muted-foreground">{position}</span>
        <div className="flex-1" />
        <Link href={prevHref ?? '#'} scroll={false} aria-disabled={!prevHref} aria-label="Sujet précédent (K)" className={navBtn}>
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link href={nextHref ?? '#'} scroll={false} aria-disabled={!nextHref} aria-label="Sujet suivant (J)" className={navBtn}>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Fermer le panneau (Échap)"
          className="flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-5">{children}</div>
    </motion.aside>
  );
}
