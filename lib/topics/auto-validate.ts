/**
 * Validation automatique des sujets proposés (remplace le tri manuel de « Sujets à valider »).
 *
 * Pour chaque sujet « proposé » :
 *  - doublon d'un sujet déjà publié de la même niche (embeddings ≥ 0,92) → fusionné dedans ;
 *  - ≥ 5 vidéos, ≥ 3 chaînes différentes, aucune chaîne > 50 % des vidéos → publié (status 'active') ;
 *  - sinon il attend : le rattachement de nuit lui ajoute des vidéos, et un sujet resté sous 5 vidéos
 *    21 jours après sa création est fermé par l'étape de nuit existante.
 * Les sujets sensibles (santé, etc.) restent à valider à la main : ils sont rares.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSensitiveTopic } from './sensitive';

const MIN_VIDEOS = Number(process.env.TOPIC_AUTO_MIN_VIDEOS ?? 5);
const MIN_CHANNELS = Number(process.env.TOPIC_AUTO_MIN_CHANNELS ?? 3);
const MAX_SHARE = Number(process.env.TOPIC_AUTO_MAX_CHANNEL_SHARE ?? 0.5);
const MERGE_SIM = Number(process.env.TOPIC_AUTO_MERGE_SIM ?? 0.92);

export interface AutoValidateResult {
  checked: number;
  published: number;
  merged: number;
  waiting: number;
  sensitive: number;
  decisions: { id: string; label: string; decision: 'published' | 'merged' | 'waiting' | 'sensitive'; reason: string }[];
}

function vec(raw: unknown): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
  }
  return [];
}
function cosine(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/** Mise à jour d'un sujet ; sans la migration 00024, on réessaie sans les colonnes de traçabilité. */
async function updateTopic(db: SupabaseClient, id: string, fields: Record<string, unknown>) {
  const { error } = await db.from('topics').update(fields).eq('id', id);
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    const { validated_by: _a, validation_reason: _b, validated_at: _c, ...rest } = fields;
    await db.from('topics').update(rest).eq('id', id);
  }
}

export async function autoValidateTopics(db: SupabaseClient, opts: { dryRun?: boolean } = {}): Promise<AutoValidateResult> {
  const res: AutoValidateResult = { checked: 0, published: 0, merged: 0, waiting: 0, sensitive: 0, decisions: [] };

  const { data: proposed, error } = await db
    .from('topics')
    .select('id, label, niche_id, embedding')
    .eq('status', 'proposed')
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`topics : ${error.message}`);
  if (!proposed?.length) return res;

  const { data: active } = await db
    .from('topics')
    .select('id, label, niche_id, embedding')
    .in('status', ['active', 'in_production'])
    .not('embedding', 'is', null)
    .limit(5000);
  const published = ((active ?? []) as { id: string; label: string; niche_id: string; embedding: unknown }[]).map((t) => ({
    id: t.id,
    label: t.label,
    nicheId: t.niche_id,
    v: vec(t.embedding),
  }));

  // Vidéos de tous les sujets proposés en une requête par lot
  const ids = proposed.map((t) => t.id as string);
  const videosByTopic = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: vids } = await db.from('videos').select('topic_id, channel_id').in('topic_id', ids.slice(i, i + 200));
    for (const v of (vids ?? []) as { topic_id: string; channel_id: string }[]) {
      videosByTopic.set(v.topic_id, [...(videosByTopic.get(v.topic_id) ?? []), v.channel_id]);
    }
  }

  const now = new Date().toISOString();
  for (const t of proposed as { id: string; label: string; niche_id: string; embedding: unknown }[]) {
    res.checked++;
    const note = (decision: AutoValidateResult['decisions'][number]['decision'], reason: string) => {
      res[decision]++;
      res.decisions.push({ id: t.id, label: t.label, decision, reason });
    };

    if (isSensitiveTopic(t.label)) {
      note('sensitive', 'Sujet sensible : validation manuelle.');
      continue;
    }

    // Doublon d'un sujet déjà publié ?
    const v = vec(t.embedding);
    let twin: { id: string; label: string; sim: number } | null = null;
    if (v.length) {
      for (const p of published) {
        if (p.nicheId !== t.niche_id) continue;
        const sim = cosine(v, p.v);
        if (sim >= MERGE_SIM && (!twin || sim > twin.sim)) twin = { id: p.id, label: p.label, sim };
      }
    }
    if (twin) {
      note('merged', `Même sujet que « ${twin.label} » (${Math.round(twin.sim * 100)} %) : vidéos fusionnées.`);
      if (!opts.dryRun) {
        await db.from('videos').update({ topic_id: twin.id }).eq('topic_id', t.id);
        await updateTopic(db, t.id, { status: 'merged', merged_into: twin.id, validated_by: 'auto', validation_reason: `Fusionné dans « ${twin.label} »`, validated_at: now });
      }
      continue;
    }

    const chans = videosByTopic.get(t.id) ?? [];
    const counts = new Map<string, number>();
    for (const c of chans) counts.set(c, (counts.get(c) ?? 0) + 1);
    const share = chans.length ? Math.max(...counts.values()) / chans.length : 1;

    if (chans.length >= MIN_VIDEOS && counts.size >= MIN_CHANNELS && share <= MAX_SHARE) {
      const reason = `${chans.length} vidéos de ${counts.size} chaînes, la plus présente en fait ${Math.round(share * 100)} %.`;
      note('published', reason);
      if (!opts.dryRun) {
        await updateTopic(db, t.id, { status: 'active', validated_by: 'auto', validation_reason: reason, validated_at: now });
        published.push({ id: t.id, label: t.label, nicheId: t.niche_id, v });
      }
    } else {
      const missing = [
        chans.length < MIN_VIDEOS ? `${chans.length}/${MIN_VIDEOS} vidéos` : null,
        counts.size < MIN_CHANNELS ? `${counts.size}/${MIN_CHANNELS} chaînes` : null,
        share > MAX_SHARE && chans.length ? `une chaîne fait ${Math.round(share * 100)} % des vidéos` : null,
      ].filter(Boolean);
      note('waiting', `En attente : ${missing.join(', ')}.`);
    }
  }
  return res;
}
