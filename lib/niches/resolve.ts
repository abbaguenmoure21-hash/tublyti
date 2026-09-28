/**
 * Shared niche resolution — accepts a name, category, or channel name.
 * Case-insensitive and accent-insensitive.
 * Returns the matched niche or null + the list of available niches.
 */

interface NicheRow {
  id: string;
  name: string;
  category?: string | null;
  owner_channel?: string | null;
}

/** Remove diacritics (accents) for comparison. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Find a niche by fuzzy matching on name, category, or owner_channel.
 * Prioritises exact match, then substring match.
 */
export function resolveNiche(
  query: string,
  niches: NicheRow[],
): { niche: NicheRow; available: string[] } | { niche: null; available: string[] } {
  const available = niches.map((n) => n.name);
  const q = stripAccents(query.toLowerCase().trim());

  if (!q) return { niche: null, available };

  // Exact match (case+accent insensitive)
  const exact = niches.find((n) => {
    const name = stripAccents(n.name.toLowerCase());
    const cat = stripAccents((n.category ?? '').toLowerCase());
    const ch = stripAccents((n.owner_channel ?? '').toLowerCase());
    return name === q || cat === q || ch === q;
  });

  if (exact) return { niche: exact, available };

  // Substring match
  const partial = niches.find((n) => {
    const name = stripAccents(n.name.toLowerCase());
    const cat = stripAccents((n.category ?? '').toLowerCase());
    const ch = stripAccents((n.owner_channel ?? '').toLowerCase());
    return name.includes(q) || cat.includes(q) || ch.includes(q) || q.includes(name);
  });

  if (partial) return { niche: partial, available };

  return { niche: null, available };
}
