'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { getToolsUser } from '@/lib/auth/session';

const NO_ACCESS = { error: 'Connecte-toi pour utiliser les favoris.' } as const;

type ToolsUser = NonNullable<Awaited<ReturnType<typeof getToolsUser>>>;

/** Limite une requête aux collections du compte (après la migration 00019). */
function mine<Q>(q: Q, user: ToolsUser): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return user.personal ? (q as any).eq('user_id', user.id) : q;
}

/** Collection « Favoris » du compte, créée au premier usage. */
async function defaultCollectionId(db: SupabaseClient, user: ToolsUser): Promise<string | null> {
  const { data } = await mine(db.from('collections').select('id').eq('is_default', true), user).limit(1).maybeSingle();
  if (data?.id) return data.id as string;
  if (!user.personal) return null;
  const { data: created } = await db
    .from('collections')
    .insert({ name: 'Favoris', is_default: true, user_id: user.id })
    .select('id')
    .single();
  return (created?.id as string | undefined) ?? null;
}

/** Vérifie qu'une collection appartient au compte. */
async function ownsCollection(db: SupabaseClient, user: ToolsUser, collectionId: string): Promise<boolean> {
  const { data } = await mine(db.from('collections').select('id').eq('id', collectionId), user).maybeSingle();
  return Boolean(data);
}

export async function getCollections() {
  const user = await getToolsUser();
  if (!user) return { data: [] };
  const db = createServiceClient();
  const { data, error } = await mine(db.from('collections').select('id, name, is_default, created_at'), user)
    .order('is_default', { ascending: false })
    .order('name');
  if (error) return { error: error.message, data: [] };
  return { data: data ?? [] };
}

export async function createCollection(name: string) {
  const user = await getToolsUser();
  if (!user) return NO_ACCESS;
  const n = name?.trim();
  if (!n) return { error: 'Le nom est requis.' };
  if (n.length > 60) return { error: 'Nom trop long (60 caractères maximum).' };
  const db = createServiceClient();
  const { data, error } = await db
    .from('collections')
    .insert({ name: n, ...(user.personal ? { user_id: user.id } : {}) })
    .select('id, name, is_default')
    .single();
  if (error) return { error: 'La collection n’a pas pu être créée.' };
  revalidatePath('/settings');
  return { data };
}

export async function deleteCollection(collectionId: string) {
  const user = await getToolsUser();
  if (!user) return NO_ACCESS;
  const db = createServiceClient();
  const { data: collection } = await mine(db.from('collections').select('is_default').eq('id', collectionId), user).maybeSingle();
  if (!collection) return { error: 'Collection introuvable.' };
  if (collection.is_default) return { error: 'Impossible de supprimer la collection « Favoris ».' };
  const { error } = await db.from('collections').delete().eq('id', collectionId);
  if (error) return { error: 'La collection n’a pas pu être supprimée.' };
  revalidatePath('/settings');
  return { success: true };
}

export async function addToCollection(collectionId: string, itemType: string, refId: string, note?: string) {
  const user = await getToolsUser();
  if (!user) return NO_ACCESS;
  const db = createServiceClient();
  if (!(await ownsCollection(db, user, collectionId))) return { error: 'Collection introuvable.' };
  const { error } = await db
    .from('collection_items')
    .upsert({ collection_id: collectionId, item_type: itemType, ref_id: refId, note: note ?? null }, { onConflict: 'collection_id,item_type,ref_id' });
  if (error) return { error: error.message };
  return { success: true };
}

export async function removeFromCollection(collectionId: string, itemType: string, refId: string) {
  const user = await getToolsUser();
  if (!user) return NO_ACCESS;
  const db = createServiceClient();
  if (!(await ownsCollection(db, user, collectionId))) return { error: 'Collection introuvable.' };
  const { error } = await db.from('collection_items').delete().eq('collection_id', collectionId).eq('item_type', itemType).eq('ref_id', refId);
  if (error) return { error: error.message };
  return { success: true };
}

/** Étoile « favori » : ajoute ou retire l'élément de la collection Favoris du compte. */
export async function toggleFavorite(itemType: string, refId: string) {
  const user = await getToolsUser();
  if (!user) return { error: 'Les favoris seront disponibles après la mise à jour de la base.' };
  const db = createServiceClient();
  const colId = await defaultCollectionId(db, user);
  if (!colId) return { error: 'Collection « Favoris » introuvable.' };

  const { data: existing } = await db
    .from('collection_items')
    .select('id')
    .eq('collection_id', colId)
    .eq('item_type', itemType)
    .eq('ref_id', refId)
    .maybeSingle();

  if (existing) {
    const { error } = await db.from('collection_items').delete().eq('id', existing.id);
    if (error) return { error: error.message };
    return { added: false };
  }
  const { error } = await db.from('collection_items').insert({ collection_id: colId, item_type: itemType, ref_id: refId });
  if (error) return { error: error.message };
  return { added: true };
}

export async function getCollectionItems(collectionId: string) {
  const user = await getToolsUser();
  if (!user) return { data: [] };
  const db = createServiceClient();
  if (!(await ownsCollection(db, user, collectionId))) return { data: [] };
  const { data, error } = await db
    .from('collection_items')
    .select('id, item_type, ref_id, note, created_at')
    .eq('collection_id', collectionId)
    .order('created_at', { ascending: false });
  if (error) return { error: error.message, data: [] };
  return { data: data ?? [] };
}

/** Identifiants des éléments en favori pour le compte connecté. */
export async function getFavoriteIds(itemType: string) {
  const user = await getToolsUser();
  if (!user) return { data: [] as string[] };
  const db = createServiceClient();
  const { data: col } = await mine(db.from('collections').select('id').eq('is_default', true), user).limit(1).maybeSingle();
  if (!col) return { data: [] as string[] };
  const { data } = await db.from('collection_items').select('ref_id').eq('collection_id', col.id).eq('item_type', itemType);
  return { data: ((data ?? []) as { ref_id: string }[]).map((d) => d.ref_id) };
}
