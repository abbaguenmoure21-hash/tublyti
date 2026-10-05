import type { SupabaseClient } from '@supabase/supabase-js';
import { buildDigestData } from '@/lib/services/digest';
import { buildDigestHtml, sendDigestEmail } from '@/lib/email/digest-email';
import { listScopeNiches, labelsByNiche } from '@/lib/scope';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tublyti.vercel.app';

async function columnExists(db: SupabaseClient, table: string): Promise<boolean> {
  const { error } = await db.from(table).select('user_id').limit(1);
  return !error;
}

/** Résumé hebdomadaire d'un compte : ses thématiques, ses vidéos publiées, ses alertes. */
export async function sendDigestToUser(
  db: SupabaseClient,
  user: { id: string; email: string; isAdmin: boolean },
): Promise<{ ok: boolean; error?: string; blocks: number }> {
  const [niches, personalAlerts] = await Promise.all([listScopeNiches(db, user.id), columnExists(db, 'alert_events')]);
  if (!niches.length && !user.isAdmin) return { ok: false, error: 'Aucune chaîne.', blocks: 0 };
  const data = await buildDigestData(db, {
    userId: user.id,
    nicheIds: user.isAdmin ? null : [...new Set(niches.map((n) => n.id))],
    labels: labelsByNiche(niches),
    personalAlerts,
    includeAlerts: personalAlerts || user.isAdmin,
  });
  if (!data.blocks.length && !data.alertEvents.length) return { ok: true, blocks: 0 };
  const res = await sendDigestEmail(buildDigestHtml(data, APP_URL), user.email);
  return { ...res, blocks: data.blocks.length };
}

/**
 * Envoi du dimanche. Après la migration 00018 : un résumé par compte ayant au moins une chaîne.
 * Avant : un seul résumé global envoyé à ALERT_EMAIL, comme avant.
 */
export async function sendAllDigests(db: SupabaseClient) {
  if (!(await columnExists(db, 'angles'))) {
    const data = await buildDigestData(db);
    const res = await sendDigestEmail(buildDigestHtml(data, APP_URL));
    return { sent: res.ok ? 1 : 0, failed: res.ok ? 0 : 1, errors: res.error ? [res.error] : [] };
  }

  const [{ data: profiles }, { data: usersPage }] = await Promise.all([
    db.from('profiles').select('user_id, role'),
    db.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const emailById = new Map((usersPage?.users ?? []).map((u) => [u.id, u.email ?? '']));

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const p of (profiles ?? []) as { user_id: string; role: string }[]) {
    const email = emailById.get(p.user_id);
    if (!email) continue;
    try {
      const r = await sendDigestToUser(db, { id: p.user_id, email, isAdmin: p.role === 'admin' });
      if (r.ok && r.blocks) sent++;
      else if (!r.ok && r.error !== 'Aucune chaîne.') {
        failed++;
        if (r.error) errors.push(r.error);
      }
    } catch (e) {
      failed++;
      errors.push(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  }
  return { sent, failed, errors: errors.slice(0, 5) };
}
