'use server';

import { revalidatePath } from 'next/cache';

export async function generateAngles(topicId: string) {
  // This calls the existing API route which uses Claude for generation.
  // We keep it as an API call because it's a long-running operation.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const res = await fetch(`${baseUrl}/api/topics/${topicId}/angles`, {
    method: 'POST',
  });

  const data = await res.json();

  if (!res.ok) {
    return { error: data.error ?? 'Erreur lors de la génération.' };
  }

  revalidatePath(`/topics/${topicId}`);
  return { success: true, costUSD: data.costUSD };
}
