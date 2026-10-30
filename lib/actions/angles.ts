'use server';

import { z } from 'zod';
import { getAdminOrNull } from '@/lib/auth/session';

import { revalidatePath } from 'next/cache';

export async function generateAngles(topicId: string) {
  // Génération payante (IA) : déclenchée par l'administration uniquement.
  if (!(await getAdminOrNull())) return { error: 'La génération d’angles est faite par l’équipe TubLyTI.' };
  // topicId is interpolated into an authenticated internal URL: accept a UUID only.
  if (!z.string().uuid().safeParse(topicId).success) return { error: 'Sujet introuvable.' };
  // This calls the existing API route which uses Claude for generation.
  // We keep it as an API call because it's a long-running operation.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL 
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const res = await fetch(`${baseUrl}/api/topics/${topicId}/angles`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET}`
    }
  });

  let data;
  try {
    data = await res.json();
  } catch (err) {
    const text = await res.text().catch(() => '');
    console.error('Failed to parse API response:', text);
    return { error: 'Erreur inattendue du serveur lors de la génération (réponse invalide).' };
  }

  if (!res.ok) {
    return { error: data?.error ?? 'Erreur lors de la génération.' };
  }

  revalidatePath(`/topics/${topicId}`);
  return { success: true, costUSD: data.costUSD };
}
