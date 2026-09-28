'use server';

import { revalidatePath } from 'next/cache';

export async function relaunchCron(kind: string, secret: string) {
  if (!secret) return { error: 'Secret requis.' };

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const res = await fetch(`${baseUrl}/api/cron/${kind}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  const data = await res.json();
  if (!res.ok) return { error: data.error ?? 'Erreur lors du lancement.' };

  revalidatePath('/admin/jobs');
  return { success: true };
}

export async function testAlert(secret: string) {
  if (!secret) return { error: 'Secret requis.' };

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const res = await fetch(`${baseUrl}/api/alerts/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });

  const data = await res.json();
  if (!res.ok) return { error: data.error ?? 'Erreur.' };

  return { success: true, method: data.method };
}
