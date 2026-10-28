/**
 * Création automatique de niches à partir des chaînes candidates « hors niche ».
 *
 * Une chaîne candidate de bonne taille qui ne ressemble à aucune niche suivie passe en statut
 * « unmatched ». Chaque nuit, ces chaînes sont regroupées par ressemblance de leurs titres :
 * dès que NICHE_AUTO_MIN_CHANNELS chaînes (3 par défaut) forment un groupe cohérent, une niche est créée,
 * nommée (Claude Haiku, ~0,002 $ par niche, plafonné par AI_BUDGET_USD), et ces chaînes y sont ajoutées.
 * Si Haiku reconnaît une niche existante, les chaînes y sont rattachées au lieu d'en créer une.
 * Sans clé Anthropic ou avec NICHE_AUTO_AI=false : nom tiré des mots les plus fréquents des titres.
 * Une chaîne restée « hors niche » 90 jours sans voisines est écartée.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { reserveAiBudget, settleAiBudget } from '../ai/budget';
import { cosine, parseVec, type Calibration } from './candidate-niche';
import { HAIKU_45, costUsd } from '../ai/pricing';

const MIN_CHANNELS = Number(process.env.NICHE_AUTO_MIN_CHANNELS ?? 3);
/** Niche proposée par l'IA : créée dès que ce nombre de chaînes la partagent (ou tout de suite pour une grosse chaîne). */
const MIN_AI_CHANNELS = Number(process.env.NICHE_AUTO_MIN_CHANNELS_AI ?? 2);
const BIG_SUBS = Number(process.env.CANDIDATE_BIG_SUBS ?? 100_000);
const MAX_PER_NIGHT = Number(process.env.NICHE_AUTO_MAX_PER_NIGHT ?? 2);
const EXPIRE_DAYS = Number(process.env.NICHE_AUTO_EXPIRE_DAYS ?? 90);
const MODEL = 'claude-haiku-4-5-20251001';

export interface UnmatchedChannel {
  id: string;
  title: string | null;
  vec: number[];
  titles: string[];
  subs: number;
  /** Nouvelle niche proposée par l'IA pour cette chaîne. */
  aiNiche?: { name: string; category: string; rpmLow: number | null; rpmHigh: number | null } | null;
}
export interface NicheCreateResult {
  created: { name: string; category: string; channels: string[]; rpm: string }[];
  joined: { niche: string; channels: string[] }[];
  waiting: number;
  expired: number;
  aiCostUSD: number;
}

function normalize(v: number[]) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
function mean(vs: number[][]) {
  const out = new Array(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < out.length; i++) out[i] += v[i];
  return normalize(out);
}
const STOP = new Set(
  'the a an and or of to in on for with how why what when your you my i is are was be this that it from by at as vs best top new get make about into can will do does not no more most all every ever just how-to'.split(' '),
);
/** Nom de secours : les 2 ou 3 mots les plus fréquents des titres. */
function keywordName(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const t of titles) {
    const seen = new Set<string>();
    for (const w of t.toLowerCase().replace(/[^a-zà-ÿ0-9 ]/g, ' ').split(/\s+/)) {
      if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w) || seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w[0].toUpperCase() + w.slice(1));
  return top.length ? top.join(' & ') : 'Nouvelle niche';
}

interface Naming {
  reject?: boolean;
  duplicate_of?: string | null;
  name?: string;
  category?: string;
  rpm_low?: number;
  rpm_high?: number;
}

async function nameWithHaiku(
  db: SupabaseClient,
  titles: string[],
  existing: { name: string; category: string }[],
): Promise<{ naming: Naming | null; cost: number }> {
  if (!process.env.ANTHROPIC_API_KEY || process.env.NICHE_AUTO_AI === 'false') return { naming: null, cost: 0 };
  // Plafond mensuel commun à toutes les dépenses IA
  const reservation = await reserveAiBudget(db, 0.01);
  if (!reservation.ok) return { naming: null, cost: 0 };
  let settled = false;

  const categories = [...new Set(existing.map((e) => e.category))];
  try {
    const anthropic = new Anthropic();
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `These are recent video titles from several YouTube channels that resemble each other:
${titles.slice(0, 40).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Existing niches (name — category):
${existing.map((e) => `- ${e.name} — ${e.category}`).join('\n')}

Decide whether these channels form one coherent YouTube content niche.
- If they clearly belong to one of the existing niches, answer {"duplicate_of": "<exact existing name>"}.
- If they are not one coherent niche (mixed, vlogs, music, kids, news), answer {"reject": true}.
- Otherwise answer {"name": "<2-4 word English niche name, same style as existing ones>", "category": "<one of: ${categories.join(', ')} — or a new short snake_case word>", "rpm_low": <typical low RPM in USD for English long-form>, "rpm_high": <typical high RPM in USD>}.
Answer with JSON only.`,
        },
      ],
    });
    const cost = costUsd(HAIKU_45, res.usage.input_tokens, res.usage.output_tokens);
    await db.from('ai_spend').insert({
      action: 'name_auto_niche',
      model: 'haiku-4.5',
      tokens_in: res.usage.input_tokens,
      tokens_out: res.usage.output_tokens,
      cost_usd: cost,
      meta: { titles: titles.length },
    });
    await settleAiBudget(db, reservation, cost);
    settled = true;
    let text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return { naming: JSON.parse(text) as Naming, cost };
  } catch (e) {
    if (!settled) await settleAiBudget(db, reservation, 0).catch(() => undefined);
    console.error(`  nommage de niche : ${(e as Error).message}`);
    return { naming: null, cost: 0 };
  }
}

/**
 * Regroupe les chaînes « hors niche » (en base + celles de cette nuit) et crée les niches.
 * dryRun : ne crée rien et n'appelle pas l'IA (nom de secours affiché).
 */
export async function createNichesFromUnmatched(
  db: SupabaseClient,
  calibration: Calibration,
  fresh: UnmatchedChannel[],
  opts: { dryRun?: boolean } = {},
): Promise<NicheCreateResult> {
  const res: NicheCreateResult = { created: [], joined: [], waiting: 0, expired: 0, aiCostUSD: 0 };
  const now = new Date();

  // Chaînes hors niche déjà en base (les plus anciennes expirent)
  const { data } = await db
    .from('candidate_channels')
    .select('id, title, embedding, recent_titles, subscriber_count, decided_at, ai_niche, ai_category, ai_rpm_low, ai_rpm_high')
    .eq('status', 'unmatched')
    .limit(1000);
  const pool = new Map<string, UnmatchedChannel>();
  const expireBefore = now.getTime() - EXPIRE_DAYS * 86_400_000;
  for (const r of (data ?? []) as {
    id: string; title: string | null; embedding: unknown; recent_titles: string[] | null; subscriber_count: number | null; decided_at: string | null;
    ai_niche: string | null; ai_category: string | null; ai_rpm_low: number | null; ai_rpm_high: number | null;
  }[]) {
    if (r.decided_at && new Date(r.decided_at).getTime() < expireBefore) {
      res.expired++;
      if (!opts.dryRun) {
        await db
          .from('candidate_channels')
          .update({ status: 'rejected', auto_reason: `Contenu trop éloigné des niches suivies, et aucune chaîne semblable en ${EXPIRE_DAYS} jours.`, decided_at: now.toISOString() })
          .eq('id', r.id);
      }
      continue;
    }
    const vec = parseVec(r.embedding);
    if (vec.length) {
      pool.set(r.id, {
        id: r.id, title: r.title, vec, titles: r.recent_titles ?? [], subs: r.subscriber_count ?? 0,
        aiNiche: r.ai_niche && r.ai_category ? { name: r.ai_niche, category: r.ai_category, rpmLow: r.ai_rpm_low, rpmHigh: r.ai_rpm_high } : null,
      });
    }
  }
  for (const f of fresh) pool.set(f.id, f);

  const { data: nicheRows } = await db.from('niches').select('id, name, category').eq('status', 'active');
  const existing = (nicheRows ?? []) as { id: string; name: string; category: string }[];

  const used = new Set<string>();
  let made = 0;

  // 1) Niches proposées par l'IA : regroupées par nom, créées dès MIN_AI_CHANNELS chaînes (ou une grosse chaîne).
  const byAiName = new Map<string, UnmatchedChannel[]>();
  for (const c of pool.values()) {
    if (!c.aiNiche) continue;
    const k = c.aiNiche.name.trim().toLowerCase();
    byAiName.set(k, [...(byAiName.get(k) ?? []), c]);
  }
  for (const group of byAiName.values()) {
    if (made >= MAX_PER_NIGHT * 3) break;
    if (group.length < MIN_AI_CHANNELS && !group.some((g) => g.subs >= BIG_SUBS)) continue;
    const proposal = group[0].aiNiche!;
    const ids = group.map((g) => g.id);
    const names = group.map((g) => g.title ?? g.id);
    for (const id of ids) used.add(id);
    const same = existing.find((e) => e.name.toLowerCase() === proposal.name.toLowerCase());
    if (same) {
      res.joined.push({ niche: same.name, channels: names });
      if (!opts.dryRun) await accept(db, ids, same.id, `Rattachée à « ${same.name} » (niche proposée par l'IA).`);
      continue;
    }
    res.created.push({ name: proposal.name, category: proposal.category, channels: names, rpm: proposal.rpmLow !== null ? `${proposal.rpmLow}–${proposal.rpmHigh} $` : '—' });
    made++;
    if (opts.dryRun) continue;
    const { data: niche, error } = await db
      .from('niches')
      .insert({
        name: proposal.name,
        category: proposal.category,
        rpm_coefficient: 1,
        rpm_low: proposal.rpmLow,
        rpm_high: proposal.rpmHigh,
        rpm_source: proposal.rpmLow !== null ? 'Estimation IA à vérifier' : null,
        status: 'active',
        auto_created: true,
        created_from: 'candidates',
        auto_reason: `Créée le ${now.toISOString().slice(0, 10)} sur proposition de l'IA, à partir de ${ids.length} chaîne(s) : ${names.slice(0, 5).join(', ')}.`,
      })
      .select('id')
      .single();
    if (error || !niche) {
      console.error(`  création de niche « ${proposal.name} » : ${error?.message}`);
      continue;
    }
    existing.push({ id: niche.id as string, name: proposal.name, category: proposal.category });
    await accept(db, ids, niche.id as string, `Nouvelle niche « ${proposal.name} » créée (proposée par l'IA) avec ${ids.length} chaîne(s).`);
  }

  // 2) Sans proposition de l'IA : regroupement par ressemblance — graine = la plus grosse chaîne restante,
  //    voisines proches, noyau resserré autour du centre.
  const left = [...pool.values()].filter((c) => !used.has(c.id) && !c.aiNiche).sort((a, b) => b.subs - a.subs);
  for (const seed of left) {
    if (used.has(seed.id) || made >= MAX_PER_NIGHT) continue;
    let group = left.filter((c) => !used.has(c.id) && cosine(seed.vec, c.vec) >= calibration.rejectSim);
    if (group.length < MIN_CHANNELS) continue;
    const center = mean(group.map((g) => g.vec));
    group = group.filter((g) => cosine(g.vec, center) >= calibration.acceptSim);
    if (group.length < MIN_CHANNELS) continue;
    for (const g of group) used.add(g.id);

    const titles = group.flatMap((g) => g.titles.slice(0, 8));
    const fallback = keywordName(titles);
    const { naming, cost } = opts.dryRun ? { naming: null, cost: 0 } : await nameWithHaiku(db, titles, existing);
    res.aiCostUSD += cost;
    if (naming?.reject) {
      // Groupe incohérent (vlogs, musique, enfants, actualité…) : écarté pour ne pas payer le même avis chaque nuit.
      if (!opts.dryRun) {
        await db
          .from('candidate_channels')
          .update({ status: 'rejected', auto_decision: 'rejected', auto_reason: 'Hors des niches suivies, et ce groupe de chaînes ne forme pas une niche cohérente.', decided_at: now.toISOString() })
          .in('id', group.map((g) => g.id));
      }
      continue;
    }

    const ids = group.map((g) => g.id);
    const names = group.map((g) => g.title ?? g.id);
    const dup = naming?.duplicate_of ? existing.find((e) => e.name.toLowerCase() === String(naming.duplicate_of).toLowerCase()) : null;

    if (dup) {
      res.joined.push({ niche: dup.name, channels: names });
      if (!opts.dryRun) await accept(db, ids, dup.id, `Rattachée à « ${dup.name} » avec ${ids.length} chaînes semblables (niche reconnue par l'IA).`);
      continue;
    }

    const name = (naming?.name ?? fallback).slice(0, 60);
    if (existing.some((e) => e.name.toLowerCase() === name.toLowerCase())) continue;
    const category = (naming?.category ?? 'other').toLowerCase().replace(/[^a-z_]/g, '_').slice(0, 30) || 'other';
    const low = Number(naming?.rpm_low);
    const high = Number(naming?.rpm_high);
    const rpmOk = low > 0 && high >= low && high < 100;
    res.created.push({ name, category, channels: names, rpm: rpmOk ? `${low}–${high} $` : '—' });
    made++;
    if (opts.dryRun) continue;

    const { data: niche, error } = await db
      .from('niches')
      .insert({
        name,
        category,
        rpm_coefficient: 1,
        rpm_low: rpmOk ? low : null,
        rpm_high: rpmOk ? high : null,
        rpm_source: rpmOk ? 'Estimation IA à vérifier' : null,
        status: 'active',
        auto_created: true,
        created_from: 'candidates',
        auto_reason: `Créée le ${now.toISOString().slice(0, 10)} à partir de ${ids.length} chaînes : ${names.slice(0, 5).join(', ')}${naming ? '' : ' (nom tiré des titres)'}.`,
      })
      .select('id')
      .single();
    if (error || !niche) {
      console.error(`  création de niche « ${name} » : ${error?.message}`);
      continue;
    }
    existing.push({ id: niche.id as string, name, category });
    await accept(db, ids, niche.id as string, `Nouvelle niche « ${name} » créée avec ${ids.length} chaînes semblables.`);
  }
  res.waiting = [...pool.keys()].filter((id) => !used.has(id)).length;
  return res;
}

async function accept(db: SupabaseClient, ids: string[], nicheId: string, reason: string) {
  await db
    .from('candidate_channels')
    .update({ status: 'accepted', auto_decision: 'accepted', niche_id: nicheId, niche_source: 'detected', auto_reason: reason, decided_at: new Date().toISOString() })
    .in('id', ids);
}
