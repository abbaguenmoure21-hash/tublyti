export interface SujetsParams {
  moment?: string;
  fiable?: string;
  q?: string;
  sujet?: string;
}

/** Construit l'adresse de la page Sujets en gardant les filtres (ERGONOMIE.md, règle 7). */
export function sujetsHref(current: SujetsParams, patch: Partial<Record<keyof SujetsParams, string | null>>): string {
  const next = new URLSearchParams();
  const merged: Record<string, string | null | undefined> = { ...current, ...patch };
  for (const key of ['moment', 'fiable', 'q', 'sujet'] as const) {
    const v = merged[key];
    if (v) next.set(key, v);
  }
  const qs = next.toString();
  return qs ? `/sujets?${qs}` : '/sujets';
}
