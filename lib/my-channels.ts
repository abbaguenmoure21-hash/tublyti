import type { SupabaseClient } from '@supabase/supabase-js';

export interface MyChannel {
  id: string;
  title: string;
  nicheId: string;
  nicheName: string;
  youtubeId: string | null;
  handle: string | null;
  thumbnailUrl: string | null;
  subscribers: number | null;
  videoCount: number | null;
  /** verified : propriété prouvée ; pending : code à placer ; legacy : ancienne fiche sans lien YouTube. */
  status: 'verified' | 'pending' | 'legacy';
  /** Code à placer dans la description (uniquement pour une chaîne en attente). */
  code: string | null;
}

/** Les chaînes d'un client pour Réglages et Bienvenue (fonctionne avant et après la migration 00021). */
export async function loadMyChannels(db: SupabaseClient, userId: string, nicheName: Map<string, string>): Promise<MyChannel[]> {
  const full = await db
    .from('user_channels')
    .select('id, title, niche_id, youtube_channel_id, handle, thumbnail_url, subscriber_count, video_count, verified_at, verification_code')
    .eq('user_id', userId)
    .order('created_at');
  const rows = (full.error
    ? (await db.from('user_channels').select('id, title, niche_id, youtube_channel_id').eq('user_id', userId).order('created_at')).data
    : full.data) as Record<string, unknown>[] | null;

  return (rows ?? []).map((r) => {
    const yt = (r.youtube_channel_id as string | null) ?? null;
    const isUc = Boolean(yt && yt.startsWith('UC'));
    const verified = full.error ? true : r.verified_at != null;
    return {
      id: r.id as string,
      title: r.title as string,
      nicheId: r.niche_id as string,
      nicheName: nicheName.get(r.niche_id as string) ?? 'Thématique retirée',
      youtubeId: isUc ? yt : null,
      handle: (r.handle as string | null) ?? null,
      thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
      subscribers: r.subscriber_count != null ? Number(r.subscriber_count) : null,
      videoCount: r.video_count != null ? Number(r.video_count) : null,
      status: !isUc ? 'legacy' : verified ? 'verified' : 'pending',
      code: !verified ? ((r.verification_code as string | null) ?? null) : null,
    };
  });
}
