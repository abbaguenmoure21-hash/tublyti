'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';

export async function getCollections() {
  const db = createServiceClient();
  const { data, error } = await db
    .from('collections')
    .select('id, name, is_default, created_at')
    .order('is_default', { ascending: false })
    .order('name');

  if (error) return { error: error.message, data: [] };
  return { data: data ?? [] };
}

export async function createCollection(name: string) {
  if (!name?.trim()) return { error: 'Le nom est requis.' };

  const db = createServiceClient();
  const { data, error } = await db
    .from('collections')
    .insert({ name: name.trim() })
    .select('id, name, is_default')
    .single();

  if (error) return { error: error.message };
  revalidatePath('/settings');
  return { data };
}

export async function deleteCollection(collectionId: string) {
  const db = createServiceClient();

  // Prevent deleting the default collection
  const { data: collection } = await db
    .from('collections')
    .select('is_default')
    .eq('id', collectionId)
    .single();

  if (collection?.is_default) {
    return { error: 'Impossible de supprimer la collection par défaut.' };
  }

  const { error } = await db
    .from('collections')
    .delete()
    .eq('id', collectionId);

  if (error) return { error: error.message };
  revalidatePath('/settings');
  return { success: true };
}

export async function addToCollection(
  collectionId: string,
  itemType: string,
  refId: string,
  note?: string,
) {
  const db = createServiceClient();

  const { error } = await db
    .from('collection_items')
    .upsert(
      { collection_id: collectionId, item_type: itemType, ref_id: refId, note: note ?? null },
      { onConflict: 'collection_id,item_type,ref_id' },
    );

  if (error) return { error: error.message };
  return { success: true };
}

export async function removeFromCollection(
  collectionId: string,
  itemType: string,
  refId: string,
) {
  const db = createServiceClient();

  const { error } = await db
    .from('collection_items')
    .delete()
    .eq('collection_id', collectionId)
    .eq('item_type', itemType)
    .eq('ref_id', refId);

  if (error) return { error: error.message };
  return { success: true };
}

export async function toggleFavorite(itemType: string, refId: string) {
  const db = createServiceClient();

  // Get default collection
  const { data: defaultCol } = await db
    .from('collections')
    .select('id')
    .eq('is_default', true)
    .single();

  if (!defaultCol) return { error: 'Collection par défaut introuvable.' };

  // Check if already in favorites
  const { data: existing } = await db
    .from('collection_items')
    .select('id')
    .eq('collection_id', defaultCol.id)
    .eq('item_type', itemType)
    .eq('ref_id', refId)
    .single();

  if (existing) {
    // Remove
    const { error } = await db
      .from('collection_items')
      .delete()
      .eq('id', existing.id);
    if (error) return { error: error.message };
    return { added: false };
  } else {
    // Add
    const { error } = await db
      .from('collection_items')
      .insert({ collection_id: defaultCol.id, item_type: itemType, ref_id: refId });
    if (error) return { error: error.message };
    return { added: true };
  }
}

export async function getCollectionItems(collectionId: string) {
  const db = createServiceClient();
  const { data, error } = await db
    .from('collection_items')
    .select('id, item_type, ref_id, note, created_at')
    .eq('collection_id', collectionId)
    .order('created_at', { ascending: false });

  if (error) return { error: error.message, data: [] };
  return { data: data ?? [] };
}

export async function getFavoriteIds(itemType: string) {
  const db = createServiceClient();

  const { data: defaultCol } = await db
    .from('collections')
    .select('id')
    .eq('is_default', true)
    .single();

  if (!defaultCol) return { data: [] };

  const { data, error } = await db
    .from('collection_items')
    .select('ref_id')
    .eq('collection_id', defaultCol.id)
    .eq('item_type', itemType);

  if (error) return { data: [] };
  return { data: (data ?? []).map((d: { ref_id: string }) => d.ref_id) };
}
