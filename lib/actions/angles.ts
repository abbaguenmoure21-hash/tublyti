'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getAdminOrNull } from '@/lib/auth/session';
import { createServiceClient } from '@/lib/supabase/server';
import { generateAnglesForTopic } from '@/lib/services/angles';

// Runs inside the calling page's function (topic page: maxDuration 300 s).
export async function generateAngles(topicId: string) {
  // Génération payante (IA) : déclenchée par l'administration uniquement.
  if (!(await getAdminOrNull())) return { error: 'La génération d’angles est faite par l’équipe TubLyTI.' };
  if (!z.string().uuid().safeParse(topicId).success) return { error: 'Sujet introuvable.' };

  // Shared service (same as the cron route, the MCP tool and the extension): no internal HTTP
  // round-trip, so CRON_SECRET never travels between our own functions.
  const res = await generateAnglesForTopic(createServiceClient(), topicId);
  if (!res.ok) return { error: res.message };

  revalidatePath(`/topics/${topicId}`);
  return { success: true, costUSD: res.costUSD };
}
