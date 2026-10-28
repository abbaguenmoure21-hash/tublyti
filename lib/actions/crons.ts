'use server';

import { assertAdmin } from '@/lib/auth/session';

import { revalidatePath } from 'next/cache';

/** Steps an admin may relaunch by hand (must match app/api/cron/<kind>). */
const RELAUNCHABLE = ['collect', 'classify', 'score'] as const;
export type RelaunchKind = (typeof RELAUNCHABLE)[number];

type ActionResult = { success: true; method?: string } | { success?: false; error: string };

/** Base URL of this deployment. Parenthesised on purpose: `a ?? b ? c : d` parses as `(a ?? b) ? c : d`. */
function siteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '');
  if (explicit) return explicit;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/** The secret is read on the server only: the admin never types or sees it. */
function cronSecret(): string | null {
  const s = process.env.CRON_SECRET;
  return s && s.trim() ? s : null;
}

function errorMessage(status: number): string {
  if (status === 401) return 'Le serveur a refusé la relance : le secret de relance n’est pas configuré correctement.';
  if (status === 409) return 'Cette étape tourne déjà. Attends qu’elle se termine avant de la relancer.';
  return 'La relance a échoué. Réessaie dans quelques minutes ; si ça persiste, regarde l’historique ci-dessous.';
}

async function callInternal(path: string, method: 'GET' | 'POST'): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const secret = cronSecret();
  if (!secret) return { ok: false, status: 401, data: {} };
  try {
    const res = await fetch(`${siteBaseUrl()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      // Non-JSON answer (HTML error page, timeout page…): keep the status only.
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

export async function relaunchCron(kind: string): Promise<ActionResult> {
  await assertAdmin();
  if (!(RELAUNCHABLE as readonly string[]).includes(kind)) {
    return { error: 'Cette étape ne peut pas être relancée à la main.' };
  }
  const res = await callInternal(`/api/cron/${kind}`, 'GET');
  if (!res.ok) return { error: errorMessage(res.status) };

  revalidatePath('/admin/jobs');
  revalidatePath('/admin');
  return { success: true };
}

export async function testAlert(): Promise<ActionResult> {
  await assertAdmin();
  const res = await callInternal('/api/alerts/test', 'POST');
  if (!res.ok) return { error: errorMessage(res.status) };
  return { success: true, method: typeof res.data.method === 'string' ? res.data.method : undefined };
}
