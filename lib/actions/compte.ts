'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import { lookupChannel, latestVideos, type YouTubeChannelCard } from '@/lib/youtube/channel-lookup';
import { cookies } from 'next/headers';
import { GOOGLE_CHANNELS_COOKIE, googleEnabled, sign, verify, type GoogleChannels } from '@/lib/youtube/google-oauth';

const NOT_SIGNED = { error: 'Connecte-toi pour continuer.' } as const;
const MAX_CHANNELS = 10;

function refresh() {
  revalidatePath('/', 'layout');
}

const VERIFY_HINT =
  'Ajoute ce code dans la description de ta chaîne (YouTube Studio › Personnalisation › Informations générales › Description), publie, puis clique sur « Vérifier ». Tu pourras l’enlever ensuite.';

/** Code de vérification lisible : TUBLYTI-7KQ2-9XZ4 */
function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `TUBLYTI-${pick()}-${pick()}`;
}

export interface ChannelPreview {
  id: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  videoCount: number;
  viewCount: number;
}

/** Étape 1 : lit la chaîne sur YouTube à partir du lien collé (rien n'est enregistré). */
export async function previewMyChannel(input: string): Promise<{ error?: string; channel?: ChannelPreview; alreadyMine?: boolean }> {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  let card: YouTubeChannelCard | null;
  try {
    card = await lookupChannel(input);
  } catch {
    return { error: 'YouTube ne répond pas pour le moment. Réessaie dans un instant.' };
  }
  if (!card) return { error: 'Chaîne introuvable. Colle le lien de ta chaîne (youtube.com/@…) ou celui d’une de tes vidéos.' };
  const db = createServiceClient();
  const [{ data: mine }, { data: other }] = await Promise.all([
    db.from('user_channels').select('id').eq('user_id', user.id).eq('youtube_channel_id', card.id).maybeSingle(),
    db.from('user_channels').select('id').eq('youtube_channel_id', card.id).neq('user_id', user.id).not('verified_at', 'is', null).maybeSingle(),
  ]);
  if (other) return { error: 'Cette chaîne est déjà reliée à un autre compte TubLyTI. Si c’est la tienne, écris-nous.' };
  return {
    channel: {
      id: card.id,
      title: card.title,
      handle: card.handle,
      thumbnailUrl: card.thumbnailUrl,
      subscriberCount: card.subscriberCount,
      videoCount: card.videoCount,
      viewCount: card.viewCount,
    },
    alreadyMine: Boolean(mine),
  };
}

/** Étape 2 : enregistre la chaîne (non vérifiée) et renvoie le code à placer dans sa description. */
export async function addMyChannel(input: { youtube: string; nicheId: string }): Promise<{ error?: string; id?: string; code?: string; verified?: boolean; hint?: string }> {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  if (!z.string().uuid().safeParse(input.nicheId).success) return { error: 'Choisis une thématique.' };
  const db = createServiceClient();

  const { count } = await db.from('user_channels').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  if ((count ?? 0) >= MAX_CHANNELS) return { error: `Tu peux ajouter jusqu’à ${MAX_CHANNELS} chaînes.` };

  const { data: niche } = await db.from('niches').select('id').eq('id', input.nicheId).eq('status', 'active').maybeSingle();
  if (!niche) return { error: 'Cette thématique n’est pas disponible.' };

  // On relit toujours la chaîne côté serveur : on ne fait pas confiance aux données du navigateur.
  let card: YouTubeChannelCard | null;
  try {
    card = await lookupChannel(input.youtube);
  } catch {
    return { error: 'YouTube ne répond pas pour le moment. Réessaie dans un instant.' };
  }
  if (!card) return { error: 'Chaîne introuvable.' };

  const { data: taken } = await db
    .from('user_channels')
    .select('id')
    .eq('youtube_channel_id', card.id)
    .neq('user_id', user.id)
    .not('verified_at', 'is', null)
    .maybeSingle();
  if (taken) return { error: 'Cette chaîne est déjà reliée à un autre compte TubLyTI.' };

  const code = newCode();
  const row = {
    user_id: user.id,
    niche_id: input.nicheId,
    title: card.title,
    youtube_channel_id: card.id,
    handle: card.handle,
    thumbnail_url: card.thumbnailUrl,
    subscriber_count: card.subscriberCount,
    video_count: card.videoCount,
    view_count: card.viewCount,
    uploads_playlist_id: card.uploadsPlaylistId,
    subscribers_checked_at: new Date().toISOString(),
    verification_code: code,
  };

  const { data: existing } = await db
    .from('user_channels')
    .select('id, verified_at, verification_code')
    .eq('user_id', user.id)
    .eq('youtube_channel_id', card.id)
    .maybeSingle();

  let id: string;
  if (existing) {
    const keepCode = (existing.verification_code as string | null) ?? code;
    await db.from('user_channels').update({ ...row, verification_code: keepCode }).eq('id', existing.id);
    id = existing.id as string;
    if (existing.verified_at) {
      refresh();
      return { id, verified: true };
    }
    refresh();
    return { id, code: keepCode, hint: VERIFY_HINT };
  }

  const { data: inserted, error } = await db.from('user_channels').insert(row).select('id').single();
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    return { error: 'Mise à jour de la base à faire : exécute la migration 00021_chaines_verifiees.sql dans Supabase.' };
  }
  if (error || !inserted) return { error: 'La chaîne n’a pas pu être ajoutée. Réessaie.' };
  id = inserted.id as string;
  refresh();
  return { id, code, hint: VERIFY_HINT };
}

/**
 * Étape 3 : vérifie que le code est bien dans la description de la chaîne.
 * Une fois vérifiée, la chaîne est ajoutée aux chaînes analysées et ses 50 dernières vidéos sont importées
 * (Résultats disponibles tout de suite).
 */
export async function verifyMyChannel(id: string): Promise<{ error?: string; success?: boolean; imported?: number }> {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const db = createServiceClient();
  const { data: ch } = await db
    .from('user_channels')
    .select('id, niche_id, youtube_channel_id, verification_code, verified_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!ch?.youtube_channel_id) return { error: 'Chaîne introuvable.' };

  if (!ch.verified_at) {
    let card: YouTubeChannelCard | null;
    try {
      card = await lookupChannel(ch.youtube_channel_id as string);
    } catch {
      return { error: 'YouTube ne répond pas pour le moment. Réessaie dans un instant.' };
    }
    const code = String(ch.verification_code ?? '');
    if (!card || !code || !card.description.toUpperCase().includes(code.toUpperCase())) {
      return {
        error: 'Le code n’est pas encore visible dans la description de ta chaîne. YouTube peut mettre quelques minutes à l’afficher : réessaie dans un instant.',
      };
    }
    const { error } = await db.from('user_channels').update({ verified_at: new Date().toISOString() }).eq('id', id);
    if (error?.code === '23505') return { error: 'Cette chaîne est déjà reliée à un autre compte TubLyTI.' };
    if (error) return { error: 'La vérification n’a pas pu être enregistrée.' };
  }

  const imported = await onboardChannel(db, ch.youtube_channel_id as string, ch.niche_id as string);

  // L'ancienne fiche sans lien YouTube (créée avant cette version) pour la même thématique devient inutile.
  await db
    .from('user_channels')
    .delete()
    .eq('user_id', user.id)
    .eq('niche_id', ch.niche_id)
    .is('youtube_channel_id', null);
  await db.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('user_id', user.id).is('onboarded_at', null);

  refresh();
  return { success: true, imported };
}

/** Chaînes trouvées par la connexion Google, encore à ajouter (lues dans le cookie signé). */
export async function readGoogleChannels(): Promise<GoogleChannels['channels']> {
  const user = await getSessionUser();
  if (!user || !googleEnabled()) return [];
  const store = await cookies();
  const data = verify<GoogleChannels>(store.get(GOOGLE_CHANNELS_COOKIE)?.value);
  if (!data || data.userId !== user.id || data.expiresAt < Date.now()) return [];
  return data.channels;
}

/**
 * Ajout d'une chaîne prouvée par la connexion Google : elle est vérifiée immédiatement,
 * sans code à placer dans la description.
 */
export async function addGoogleChannel(channelId: string, nicheId: string): Promise<{ error?: string; success?: boolean; imported?: number }> {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  if (!z.string().uuid().safeParse(nicheId).success) return { error: 'Choisis une thématique.' };
  if (!googleEnabled()) return { error: 'La connexion Google n’est pas encore disponible.' };
  const store = await cookies();
  const data = verify<GoogleChannels>(store.get(GOOGLE_CHANNELS_COOKIE)?.value);
  if (!data || data.userId !== user.id || data.expiresAt < Date.now()) {
    return { error: 'La connexion Google a expiré. Reconnecte-toi avec Google.' };
  }
  if (!data.channels.some((c) => c.id === channelId)) return { error: 'Cette chaîne ne fait pas partie de ton compte Google.' };

  const db = createServiceClient();
  const { data: niche } = await db.from('niches').select('id').eq('id', nicheId).eq('status', 'active').maybeSingle();
  if (!niche) return { error: 'Cette thématique n’est pas disponible.' };

  const { data: taken } = await db
    .from('user_channels')
    .select('id')
    .eq('youtube_channel_id', channelId)
    .neq('user_id', user.id)
    .not('verified_at', 'is', null)
    .maybeSingle();
  if (taken) return { error: 'Cette chaîne est déjà reliée à un autre compte TubLyTI. Écris-nous si c’est une erreur.' };

  let card: YouTubeChannelCard | null;
  try {
    card = await lookupChannel(channelId);
  } catch {
    return { error: 'YouTube ne répond pas pour le moment. Réessaie dans un instant.' };
  }
  if (!card) return { error: 'Chaîne introuvable.' };

  const row = {
    user_id: user.id,
    niche_id: nicheId,
    title: card.title,
    youtube_channel_id: card.id,
    handle: card.handle,
    thumbnail_url: card.thumbnailUrl,
    subscriber_count: card.subscriberCount,
    video_count: card.videoCount,
    view_count: card.viewCount,
    uploads_playlist_id: card.uploadsPlaylistId,
    subscribers_checked_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
    verification_code: null,
  };
  const { data: existing } = await db.from('user_channels').select('id').eq('user_id', user.id).eq('youtube_channel_id', card.id).maybeSingle();
  const { error } = existing
    ? await db.from('user_channels').update(row).eq('id', existing.id)
    : await db.from('user_channels').insert(row);
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    return { error: 'Mise à jour de la base à faire : exécute la migration 00021_chaines_verifiees.sql dans Supabase.' };
  }
  if (error?.code === '23505') return { error: 'Cette chaîne est déjà reliée à un autre compte TubLyTI.' };
  if (error) return { error: 'La chaîne n’a pas pu être ajoutée. Réessaie.' };

  const imported = await onboardChannel(db, card.id, nicheId);
  await db.from('user_channels').delete().eq('user_id', user.id).eq('niche_id', nicheId).is('youtube_channel_id', null);
  await db.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('user_id', user.id).is('onboarded_at', null);

  // La chaîne ajoutée sort de la liste en attente.
  const rest = data.channels.filter((c) => c.id !== channelId);
  if (rest.length) {
    store.set(GOOGLE_CHANNELS_COOKIE, sign({ ...data, channels: rest }), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 900,
    });
  } else {
    store.delete(GOOGLE_CHANNELS_COOKIE);
  }
  refresh();
  return { success: true, imported };
}

/** Ferme la liste des chaînes trouvées via Google. */
export async function dismissGoogleChannels() {
  const store = await cookies();
  store.delete(GOOGLE_CHANNELS_COOKIE);
  refresh();
  return { success: true };
}

/** Ajoute la chaîne vérifiée au catalogue analysé chaque nuit et importe ses dernières vidéos. */
async function onboardChannel(db: ReturnType<typeof createServiceClient>, channelId: string, nicheId: string): Promise<number> {
  const card = await lookupChannel(channelId).catch(() => null);
  if (!card) return 0;
  await db.from('channels').upsert(
    {
      id: card.id,
      niche_id: nicheId,
      title: card.title,
      subscriber_count: card.subscriberCount ?? 0,
      uploads_playlist_id: card.uploadsPlaylistId,
      last_checked_at: new Date().toISOString(),
    },
    { onConflict: 'id', ignoreDuplicates: false },
  );
  if (!card.uploadsPlaylistId) return 0;
  const videos = await latestVideos(card.uploadsPlaylistId).catch(() => []);
  if (!videos.length) return 0;
  await db.from('videos').upsert(
    videos.map((v) => ({
      id: v.id,
      channel_id: card.id,
      title: v.title,
      published_at: v.publishedAt,
      duration_s: v.durationS,
      thumbnail_url: v.thumbnailUrl,
    })),
    { onConflict: 'id', ignoreDuplicates: true },
  );
  const now = new Date().toISOString();
  await db.from('video_snapshots').upsert(
    videos.map((v) => ({ video_id: v.id, captured_at: now, views: v.views, likes: v.likes, comments: v.comments })),
    { onConflict: 'video_id,captured_at', ignoreDuplicates: true },
  );
  return videos.length;
}

/** Renomme une chaîne du client. */
export async function renameMyChannel(id: string, title: string) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const t = title.trim();
  if (!t || t.length > 80) return { error: 'Indique un nom de 1 à 80 caractères.' };
  const { error } = await createServiceClient().from('user_channels').update({ title: t }).eq('id', id).eq('user_id', user.id);
  if (error) return { error: 'Le nom n’a pas pu être changé.' };
  refresh();
  return { success: true };
}

/** Retire une chaîne. Ses vidéos dans « Mes vidéos » sont conservées. */
export async function removeMyChannel(id: string) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const { error } = await createServiceClient().from('user_channels').delete().eq('id', id).eq('user_id', user.id);
  if (error) return { error: 'La chaîne n’a pas pu être retirée.' };
  refresh();
  return { success: true };
}

/** Suivre une thématique sans y avoir de chaîne (exploration). */
export async function followNiche(nicheId: string) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  if (!z.string().uuid().safeParse(nicheId).success) return { error: 'Thématique introuvable.' };
  const db = createServiceClient();
  // Only active niches can be followed (same rule as addMyChannel).
  const { data: niche } = await db.from('niches').select('id').eq('id', nicheId).eq('status', 'active').maybeSingle();
  if (!niche) return { error: 'Thématique introuvable.' };
  const { error } = await db.from('user_niches').upsert({ user_id: user.id, niche_id: nicheId });
  if (error) return { error: 'La thématique n’a pas pu être suivie.' };
  refresh();
  return { success: true };
}

export async function unfollowNiche(nicheId: string) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  await createServiceClient().from('user_niches').delete().eq('user_id', user.id).eq('niche_id', nicheId);
  refresh();
  return { success: true };
}

/** Nom affiché dans l'app. */
export async function updateDisplayName(name: string) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const n = name.trim();
  if (!n || n.length > 60) return { error: 'Indique un nom de 1 à 60 caractères.' };
  const { error } = await createServiceClient().from('profiles').upsert({ user_id: user.id, display_name: n });
  if (error) return { error: 'Le nom n’a pas pu être enregistré.' };
  refresh();
  return { success: true };
}
