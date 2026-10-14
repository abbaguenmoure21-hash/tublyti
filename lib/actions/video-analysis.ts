'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import { getVideoRetention } from '@/lib/youtube/analytics';
import {
  analyzeVideo,
  getVideoAnalysis,
  parseVideoId,
  retentionContextFrom,
  videoAnalysisEnabled,
  type RetentionContext,
  type StoredAnalysis,
} from '@/lib/video/analyze';

const DAILY_LIMIT = Number(process.env.VIDEO_ANALYSIS_DAILY ?? 15);

export type VideoAnalysisResponse =
  | { ok: true; row: StoredAnalysis; cached: boolean }
  | { ok: false; message: string; reason?: string };

/** Analyse déjà faite (ou null), sans rien lancer. */
export async function readVideoAnalysis(video: string): Promise<{ enabled: boolean; row: StoredAnalysis | null }> {
  const user = await getSessionUser();
  const id = parseVideoId(video);
  if (!user || !id) return { enabled: videoAnalysisEnabled(), row: null };
  return { enabled: videoAnalysisEnabled(), row: await getVideoAnalysis(createServiceClient(), id) };
}

/**
 * Lance (ou relit) l'analyse d'une vidéo.
 * channelId : ligne user_channels de l'utilisateur quand la vidéo est à lui → la courbe de rétention
 * est ajoutée pour expliquer ce qui se passe à chaque décrochage.
 */
export async function runVideoAnalysis(video: string, opts: { channelId?: string } = {}): Promise<VideoAnalysisResponse> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Connecte-toi pour analyser une vidéo.' };
  const id = parseVideoId(video);
  if (!id) return { ok: false, message: 'Lien ou ID de vidéo YouTube invalide.' };
  const db = createServiceClient();

  // Plafond quotidien par compte (les analyses déjà en cache ne comptent pas).
  const cached = await getVideoAnalysis(db, id);
  if (user.role !== 'admin' && !(cached?.status === 'done')) {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { count } = await db
      .from('video_analyses')
      .select('video_id', { count: 'exact', head: true })
      .eq('requested_by', user.id)
      .gte('created_at', since);
    if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, message: `Tu as atteint ${DAILY_LIMIT} analyses sur 24 h. Réessaie demain.` };
  }

  let retention: RetentionContext | null = null;
  if (opts.channelId) {
    const { data: ch } = await db.from('user_channels').select('id').eq('id', opts.channelId).eq('user_id', user.id).maybeSingle();
    if (ch) {
      const ret = await getVideoRetention(db, ch.id as string, id).catch(() => null);
      if (ret?.status === 'ok') retention = retentionContextFrom(ret.data.points);
    }
  }

  const res = await analyzeVideo(db, id, { userId: user.id, retention });
  if (!res.ok) return { ok: false, message: res.message, reason: res.reason };
  return { ok: true, row: res.row, cached: res.cached };
}
