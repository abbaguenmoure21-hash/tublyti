'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { sujetsHref, type SujetsParams } from './url';

/** Champ de recherche : filtre la liste pendant la frappe (300 ms), garde la recherche dans l'adresse. « / » pour y aller. */
export function SearchField({ params }: { params: SujetsParams }) {
  const router = useRouter();
  const [value, setValue] = useState(params.q ?? '');
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value === (params.q ?? '')) return;
    const t = setTimeout(() => {
      startTransition(() => router.replace(sujetsHref(params, { q: value.trim() || null, sujet: null }), { scroll: false }));
    }, 300);
    return () => clearTimeout(t);
  }, [value, params, router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <label className="relative flex h-9 w-full items-center gap-2 rounded-[10px] bg-muted px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:w-[300px]">
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">Chercher un sujet</span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue('');
            inputRef.current?.blur();
          }
        }}
        placeholder="Chercher un sujet"
        aria-busy={pending}
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" onClick={() => setValue('')} aria-label="Effacer la recherche" className="relative rounded-full p-0.5 hover:text-foreground after:absolute after:-inset-3 md:after:hidden">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : (
        <kbd className="rounded border border-border bg-card px-1.5 font-mono text-[11px]" aria-hidden="true">/</kbd>
      )}
    </label>
  );
}
