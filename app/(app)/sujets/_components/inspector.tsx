'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useDragControls, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface Props {
  position: string;
  prevHref: string | null;
  nextHref: string | null;
  closeHref: string;
  children: React.ReactNode;
}

/** Below md the panel is a full-screen sheet. */
function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}

/**
 * Panneau inspecteur à droite (bureau) ou feuille plein écran (mobile) qu'on ferme en la glissant vers le bas.
 * Non modal sur bureau : la liste reste utilisable à côté (ERGONOMIE.md, règle 2).
 */
export function Inspector({ position, prevHref, nextHref, closeHref, children }: Props) {
  const reduce = useReducedMotion();
  const mobile = useIsMobile();
  const router = useRouter();
  const dragControls = useDragControls();

  // Mobile sheet: the list behind must not scroll.
  useEffect(() => {
    if (!mobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobile]);

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
    'flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-40 md:h-8 md:w-8';
  const canDrag = mobile && !reduce;

  return (
    <motion.aside
      ref={ref}
      tabIndex={-1}
      aria-label="Aperçu du sujet"
      // Entrance is CSS (per breakpoint, so the very first mobile open already comes from the bottom,
      // without a server/client mismatch); framer only handles the drag-to-close gesture.
      initial={false}
      drag={canDrag ? 'y' : false}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > 120 || info.velocity.y > 600) router.replace(closeHref, { scroll: false });
      }}
      className="fixed inset-0 z-50 flex flex-col bg-card animate-in fade-in slide-in-from-bottom-12 duration-200 motion-reduce:animate-none md:slide-in-from-bottom-0 md:slide-in-from-right-6 md:elev-3 md:sticky md:inset-auto md:top-2 md:z-auto md:my-2 md:mr-2 md:h-[calc(100vh-16px)] md:w-[440px] md:shrink-0 md:overflow-hidden md:rounded-[22px] outline-none"
    >
      <div
        onPointerDown={(e) => canDrag && dragControls.start(e)}
        className="shrink-0 touch-none border-b border-border pt-[env(safe-area-inset-top)] md:touch-auto md:pt-0"
      >
        {/* Grab handle: drag down to close (mobile). */}
        <div className="flex justify-center pt-2 md:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-border" />
        </div>
        <div className="flex h-14 items-center gap-2 px-5">
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
            className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:h-8 md:w-8"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pt-5">{children}</div>
    </motion.aside>
  );
}
