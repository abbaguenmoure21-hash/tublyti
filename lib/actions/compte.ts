'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';

const NOT_SIGNED = { error: 'Connecte-toi pour continuer.' } as const;
const MAX_CHANNELS = 10;

function refresh() {
  revalidatePath('/', 'layout');
}

const ChannelInput = z.object({
  title: z.string().trim().min(1, 'Indique le nom de ta chaîne.').max(80, 'Nom trop long (80 caractères maximum).'),
  nicheId: z.string().uuid('Choisis une thématique.'),
  youtube: z.string().trim().max(200).optional(),
});

/** Extrait l'identifiant UC… d'une adresse de chaîne, si présent. Les @pseudos sont gardés tels quels. */
function normalizeYoutube(raw: string | undefined): string | null {
  if (!raw) return null;
  const uc = raw.match(/UC[\w-]{22}/);
  if (uc) return uc[0];
  const handle = raw.match(/@[\w.-]+/);
  return handle ? handle[0] : null;
}

/** Ajoute une chaîne du client (rattachée à une thématique du catalogue). */
export async function addMyChannel(input: { title: string; nicheId: string; youtube?: string }) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const parsed = ChannelInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Informations incomplètes.' };
  const db = createServiceClient();

  const { count } = await db.from('user_channels').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  if ((count ?? 0) >= MAX_CHANNELS) return { error: `Tu peux ajouter jusqu’à ${MAX_CHANNELS} chaînes.` };

  const { data: niche } = await db.from('niches').select('id').eq('id', parsed.data.nicheId).eq('status', 'active').maybeSingle();
  if (!niche) return { error: 'Cette thématique n’est pas disponible.' };

  const { error } = await db.from('user_channels').insert({
    user_id: user.id,
    niche_id: parsed.data.nicheId,
    title: parsed.data.title,
    youtube_channel_id: normalizeYoutube(parsed.data.youtube),
  });
  if (error?.code === '23505') return { error: 'Tu as déjà une chaîne sur cette thématique.' };
  if (error) return { error: 'La chaîne n’a pas pu être ajoutée. Réessaie.' };

  // Une thématique suivie devient une chaîne : on retire le doublon.
  await db.from('user_niches').delete().eq('user_id', user.id).eq('niche_id', parsed.data.nicheId);
  await db.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('user_id', user.id).is('onboarded_at', null);
  refresh();
  return { success: true };
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
  const { error } = await createServiceClient().from('user_niches').upsert({ user_id: user.id, niche_id: nicheId });
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
