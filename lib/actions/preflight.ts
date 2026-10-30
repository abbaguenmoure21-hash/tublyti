'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { consumeUserQuota, QUOTA_MESSAGE } from '@/lib/auth/user-quota';
import { getSessionUser } from '@/lib/auth/session';
import { getPublicStats } from '@/lib/youtube/public-stats';
import { runPreflight, type PreflightResult } from '@/lib/preflight/engine';
import { fileState, startUpload } from '@/lib/preflight/video-file';
import { geminiEnabled } from '@/lib/ai/gemini';
import { accountNicheIds, keywordNicheFilter } from '@/lib/auth/account-scope';
import { compareKeywords, type KeywordComparison } from '@/lib/keywords';

const DAILY_LIMIT = Number(process.env.PREFLIGHT_DAILY ?? 30);
const MAX_THUMB_BYTES = 2_500_000;
const MAX_VIDEO_BYTES = 2_000_000_000;

export type PreflightResponse = { ok: true; id: string | null; result: PreflightResult } | { ok: false; message: string; /** The uploaded video was sent to the engine (and deleted afterwards): it must be sent again. */ videoUsed?: boolean };

async function ownChannel(userId: string, userChannelId: string) {
  const db = createServiceClient();
  const { data } = await db
    .from('user_channels')
    .select('id, niche_id, youtube_channel_id, verified_at')
    .eq('id', userChannelId)
    .eq('user_id', userId)
    .maybeSingle();
  return { db, ch: data && data.verified_at ? (data as { id: string; niche_id: string; youtube_channel_id: string | null }) : null };
}

export async function evaluateBeforePublish(input: {
  userChannelId: string;
  titles: string[];
  script?: string;
  thumbnail?: { mimeType: string; base64: string; tinyBase64?: string | null } | null;
  video?: { name: string; uri: string; mimeType: string; durationS?: number | null } | null;
  /** Date de publication prévue (ISO). */
  publishAt?: string | null;
}): Promise<PreflightResponse> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Connecte-toi pour évaluer une vidéo.' };
  const titles = (input.titles ?? []).map((t) => String(t ?? '').trim().slice(0, 150)).filter(Boolean);
  if (!titles.length) return { ok: false, message: 'Écris au moins un titre.' };
  if (input.thumbnail) {
    if (!/^image\/(jpeg|png|webp)$/.test(input.thumbnail.mimeType)) return { ok: false, message: 'Miniature : JPG, PNG ou WebP uniquement.' };
    if (input.thumbnail.base64.length * 0.75 > MAX_THUMB_BYTES) return { ok: false, message: 'Miniature trop lourde (2 Mo maximum).' };
  }

  const { db, ch } = await ownChannel(user.id, input.userChannelId);
  if (!ch) return { ok: false, message: 'Choisis une de tes chaînes vérifiées.' };

  if (user.role !== 'admin') {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { count } = await db.from('preflight_checks').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
    if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, message: `Tu as fait ${DAILY_LIMIT} évaluations sur 24 h. Réessaie demain.` };
  }

  try {
    const stats = await getPublicStats(db, ch.id).catch(() => null);
    const { id, result } = await runPreflight(db, {
      userId: user.id,
      userChannelId: ch.id,
      nicheId: ch.niche_id,
      titles,
      script: input.script?.slice(0, 60_000) ?? null,
      thumbnail: input.thumbnail ?? null,
      video: input.video && /^files\/[\w-]+$/.test(input.video.name) ? input.video : null,
      baselineViews: stats?.medianViews || null,
      ytChannelId: ch.youtube_channel_id,
      publishAt: input.publishAt ? new Date(input.publishAt) : null,
    });
    revalidatePath('/preflight');
    return { ok: true, id, result };
  } catch (e) {
    console.error('[preflight] evaluation failed', e);
    return { ok: false, message: 'L’évaluation a échoué. Réessaie dans un instant.', videoUsed: Boolean(input.video) };
  }
}

/** Rattache une évaluation à la vidéo publiée (quand le titre a changé et que le rattachement auto ne l'a pas trouvée). */
export async function linkCheckToVideo(checkId: string, videoId: string | null): Promise<{ ok: boolean; message?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Connecte-toi.' };
  if (videoId && !/^[\w-]{11}$/.test(videoId)) return { ok: false, message: 'Vidéo invalide.' };
  const db = createServiceClient();
  const { error } = await db
    .from('preflight_checks')
    .update({ video_id: videoId, linked_at: videoId ? new Date().toISOString() : null, actual: null, actual_multiple: null })
    .eq('id', checkId)
    .eq('user_id', user.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath('/preflight');
  return { ok: true };
}

/** Ouvre l'envoi de la vidéo finie : le navigateur dépose ensuite le fichier directement chez Gemini. */
export async function startVideoUpload(input: { size: number; mimeType: string; name: string }): Promise<{ ok: true; uploadUrl: string } | { ok: false; message: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Connecte-toi.' };
  if (!geminiEnabled()) return { ok: false, message: 'L’analyse de la vidéo n’est pas disponible pour le moment.' };
  if (!/^video\//.test(input.mimeType)) return { ok: false, message: 'Choisis un fichier vidéo (MP4, MOV, WebM).' };
  if (!(input.size > 0) || input.size > MAX_VIDEO_BYTES) return { ok: false, message: 'Vidéo trop lourde : 2 Go maximum.' };
  if (!(await consumeUserQuota(createServiceClient(), user, 'video_upload'))) return { ok: false, message: QUOTA_MESSAGE };
  try {
    return { ok: true, uploadUrl: await startUpload(input.size, input.mimeType, input.name || 'video') };
  } catch (e) {
    console.error('[preflight] video upload start failed', e);
    return { ok: false, message: 'L’envoi de la vidéo n’a pas pu démarrer. Réessaie dans un instant.' };
  }
}

/** État du fichier chez Gemini après l'envoi (« PROCESSING » puis « ACTIVE »). */
export async function videoUploadState(name: string): Promise<{ state: string; uri?: string; mimeType?: string; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { state: 'FAILED', error: 'Connecte-toi.' };
  try {
    return await fileState(name);
  } catch (e) {
    console.error('[preflight] video state failed', e);
    return { state: 'FAILED', error: 'Impossible de suivre la préparation de la vidéo. Renvoie-la pour réessayer.' };
  }

}

/** « Quel mot attire le plus ? » : 2 à 4 mots comparés sur les vidéos de la niche (ou de toutes les niches). */
export async function compareKeywordsAction(userChannelId: string, terms: string[], scope: 'niche' | 'all'): Promise<{ ok: true; data: KeywordComparison } | { ok: false; message: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Connecte-toi.' };
  const clean = (terms ?? []).map((t) => String(t ?? '').trim().slice(0, 60)).filter((t) => t.length >= 2);
  if (clean.length < 2) return { ok: false, message: 'Écris au moins deux mots à comparer.' };
  const { db, ch } = await ownChannel(user.id, userChannelId);
  if (!ch) return { ok: false, message: 'Choisis une de tes chaînes vérifiées.' };
  try {
    // scope 'all' = whole catalogue for the team only; a client stays within its own themes (as in MCP).
    const accountIds = scope === 'all' && user.role !== 'admin' ? ((await accountNicheIds(db, user)) ?? []) : [];
    return { ok: true, data: await compareKeywords(db, clean, keywordNicheFilter(user.role, scope, ch.niche_id, accountIds)) };
  } catch (e) {
    console.error('[preflight] keyword comparison failed', e);
    return { ok: false, message: 'La comparaison n’a pas pu être faite. Réessaie dans un instant.' };
  }
}
