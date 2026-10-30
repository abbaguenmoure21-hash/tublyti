'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import { lookupChannel, latestVideos } from '@/lib/youtube/channel-lookup';
import { decrypt } from '@/lib/crypto/tokens';
import { getChannelAnalytics, getVideoRetention, type Period } from '@/lib/youtube/analytics';

const NOT_SIGNED = { error: 'Connecte-toi pour continuer.' } as const;

async function ownVerified(userId: string, id: string) {
  const db = createServiceClient();
  const { data } = await db
    .from('user_channels')
    .select('id, youtube_channel_id, verified_at, subscribers_checked_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data || !data.verified_at) return { db, row: null };
  return { db, row: data as { id: string; youtube_channel_id: string | null; subscribers_checked_at: string | null } };
}

/** Met à jour les chiffres publics de la chaîne et de ses 50 dernières vidéos (3 unités, une fois par heure au plus). */
export async function refreshChannelPublic(id: string): Promise<{ error?: string; success?: boolean }> {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const { db, row } = await ownVerified(user.id, id);
  if (!row?.youtube_channel_id?.startsWith('UC')) return { error: 'Vérifie d’abord cette chaîne.' };
  if (row.subscribers_checked_at && Date.now() - new Date(row.subscribers_checked_at).getTime() < 3_600_000) {
    return { error: 'Chiffres déjà mis à jour il y a moins d’une heure.' };
  }
  const card = await lookupChannel(row.youtube_channel_id).catch(() => null);
  if (!card) return { error: 'YouTube ne répond pas pour le moment. Réessaie dans un instant.' };
  const now = new Date().toISOString();
  await db
    .from('user_channels')
    .update({
      title: card.title,
      handle: card.handle,
      thumbnail_url: card.thumbnailUrl,
      subscriber_count: card.subscriberCount,
      video_count: card.videoCount,
      view_count: card.viewCount,
      uploads_playlist_id: card.uploadsPlaylistId,
      subscribers_checked_at: now,
    })
    .eq('id', id);
  await db.from('channels').update({ subscriber_count: card.subscriberCount ?? 0, last_checked_at: now }).eq('id', card.id);
  if (card.uploadsPlaylistId) {
    const videos = await latestVideos(card.uploadsPlaylistId).catch(() => []);
    if (videos.length) {
      await db.from('videos').upsert(
        videos.map((v) => ({ id: v.id, channel_id: card.id, title: v.title, published_at: v.publishedAt, duration_s: v.durationS, thumbnail_url: v.thumbnailUrl })),
        { onConflict: 'id', ignoreDuplicates: true },
      );
      await db.from('video_snapshots').upsert(
        videos.map((v) => ({ video_id: v.id, captured_at: now, views: v.views, likes: v.likes, comments: v.comments })),
        { onConflict: 'video_id,captured_at', ignoreDuplicates: true },
      );
    }
  }
  revalidatePath('/my-channel');
  return { success: true };
}

/** Recharge les statistiques YouTube Analytics sans attendre la fin du cache de 6 heures. */
export async function refreshAnalytics(id: string, period: Period): Promise<{ error?: string; success?: boolean }> {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const { db, row } = await ownVerified(user.id, id);
  if (!row) return { error: 'Chaîne introuvable.' };
  const res = await getChannelAnalytics(db, id, period, true);
  if (res.status === 'erreur') {
    return { error: res.reason === 'acces-retire' ? 'L’accès a été retiré dans ton compte Google. Reconnecte YouTube Analytics.' : 'YouTube Analytics ne répond pas. Réessaie plus tard.' };
  }
  revalidatePath('/my-channel');
  return { success: true };
}

/** Retire l'accès YouTube Analytics : jeton révoqué chez Google, puis effacé avec les chiffres en cache. */
export async function disconnectAnalytics(id: string): Promise<{ error?: string; success?: boolean }> {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const db = createServiceClient();
  const { data: tok } = await db
    .from('user_channel_tokens')
    .select('refresh_token_enc')
    .eq('user_channel_id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!tok) return { success: true };
  try {
    const refresh = decrypt(tok.refresh_token_enc as string);
    const res = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) console.error('[analytics] Google token revoke failed', res.status);
  } catch (e) {
    // Le jeton est effacé de toute façon ; il peut aussi être retiré depuis myaccount.google.com.
    console.error('[analytics] Google token revoke failed', e instanceof Error ? e.message : e);
  }
  const { error: delError } = await db
    .from('user_channel_tokens')
    .delete()
    .eq('user_channel_id', id)
    .eq('user_id', user.id);
  if (delError) {
    console.error('[analytics] token delete failed', delError.message);
    return { error: 'La déconnexion n’a pas abouti. Réessaie dans un instant.' };
  }
  const { error: analyticsError } = await db.from('channel_analytics').delete().eq('user_channel_id', id);
  if (analyticsError) console.error('[analytics] channel_analytics delete failed', analyticsError.message);
  revalidatePath('/my-channel');
  return { success: true };
}

/** Courbe de rétention d'une vidéo de la chaîne (chargée à la demande depuis Ma chaîne). */
export async function loadRetention(id: string, videoId: string) {
  const user = await getSessionUser();
  if (!user) return { status: 'erreur' as const, reason: 'autre' as const };
  const { db, row } = await ownVerified(user.id, id);
  if (!row || !/^[\w-]{11}$/.test(videoId)) return { status: 'erreur' as const, reason: 'autre' as const };
  return getVideoRetention(db, id, videoId);
}
