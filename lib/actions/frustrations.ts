'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';

export async function correctLabel(commentId: string, newLabel: string) {
  if (!commentId || !newLabel) {
    return { error: 'Paramètres manquants.' };
  }

  const db = createServiceClient();

  const { error } = await db
    .from('comment_labels')
    .update({
      label: newLabel,
      model: 'human',
      confidence: 1.0,
    })
    .eq('comment_id', commentId);

  if (error) return { error: error.message };

  revalidatePath('/frustrations');
  return { success: true };
}
