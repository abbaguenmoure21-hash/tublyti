/**
 * Impressions et taux de clic (CTR) des miniatures — YouTube Reporting API.
 *
 * 1. À la connexion (et chaque nuit si besoin), une « tâche » channel_reach_basic_a1 est créée pour la chaîne.
 * 2. YouTube dépose ensuite un fichier CSV par jour (premier fichier sous 48 h, 30 jours d'historique rattrapés).
 * 3. Chaque nuit, les nouveaux fichiers sont téléchargés et rangés dans video_reach_daily.
 * Aucun quota de l'API YouTube Data n'est consommé.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '../crypto/tokens';
import { accessToken } from './analytics';

const API = 'https://youtubereporting.googleapis.com/v1';
const REPORT_TYPE = 'channel_reach_basic_a1';

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`reporting ${path.split('?')[0]} ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/** Crée (ou retrouve) la tâche de rapport « portée » de la chaîne. Renvoie son identifiant. */
export async function ensureReachJob(db: SupabaseClient, userChannelId: string, token: string): Promise<string> {
  const { data: existing } = await db.from('reporting_jobs').select('job_id').eq('user_channel_id', userChannelId).maybeSingle();
  if (existing?.job_id) return existing.job_id as string;
  const list = await call<{ jobs?: { id: string; reportTypeId: string }[] }>(token, '/jobs');
  let job = (list.jobs ?? []).find((j) => j.reportTypeId === REPORT_TYPE);
  if (!job) job = await call<{ id: string; reportTypeId: string }>(token, '/jobs', { method: 'POST', body: JSON.stringify({ reportTypeId: REPORT_TYPE, name: 'TubLyTI reach' }) });
  await db.from('reporting_jobs').upsert({ user_channel_id: userChannelId, job_id: job.id, report_type: REPORT_TYPE });
  return job.id;
}

/** CSV simple (YouTube n'utilise ni guillemets ni virgules dans ces colonnes). */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const head = (lines.shift() ?? '').split(',');
  return lines.map((l) => {
    const cells = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

export interface ReachSyncResult {
  channels: number;
  jobsCreated: number;
  files: number;
  rows: number;
  errors: string[];
}

/** Étape de nuit : pour chaque chaîne connectée, crée la tâche si besoin puis importe les nouveaux fichiers. */
export async function syncReachReports(db: SupabaseClient, deadlineMs: number): Promise<ReachSyncResult> {
  const res: ReachSyncResult = { channels: 0, jobsCreated: 0, files: 0, rows: 0, errors: [] };
  const { data: toks, error } = await db.from('user_channel_tokens').select('user_channel_id, refresh_token_enc');
  if (error) throw new Error(`user_channel_tokens : ${error.message}`);

  for (const t of (toks ?? []) as { user_channel_id: string; refresh_token_enc: string }[]) {
    if (Date.now() >= deadlineMs) break;
    res.channels++;
    try {
      const token = await accessToken(decrypt(t.refresh_token_enc));
      const { data: before } = await db.from('reporting_jobs').select('job_id, last_report_created').eq('user_channel_id', t.user_channel_id).maybeSingle();
      const jobId = await ensureReachJob(db, t.user_channel_id, token);
      if (!before) res.jobsCreated++;

      const after = (before?.last_report_created as string | null) ?? null;
      const list = await call<{ reports?: { id: string; createTime: string; startTime: string; downloadUrl: string }[] }>(
        token,
        `/jobs/${jobId}/reports${after ? `?createdAfter=${encodeURIComponent(after)}` : ''}`,
      );
      const reports = (list.reports ?? []).sort((a, b) => a.createTime.localeCompare(b.createTime));
      let last = after;
      for (const r of reports) {
        if (Date.now() >= deadlineMs) break;
        const file = await fetch(r.downloadUrl, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (!file.ok) throw new Error(`téléchargement ${file.status}`);
        const rows = parseCsv(await file.text());
        // Échelle du CTR : fraction (0,05) ou pourcentage (5) selon le fichier ; un CTR > 30 % n'existe pas en pratique.
        const percentScale = rows.some((x) => Number(x.video_thumbnail_impressions_ctr) > 0.3);
        // Plusieurs lignes possibles par vidéo et par jour : on agrège (impressions additionnées, CTR pondéré).
        const agg = new Map<string, { video_id: string; day: string; impressions: number; clicks: number }>();
        for (const x of rows) {
          if (!x.video_id || !x.date) continue;
          const day = `${x.date.slice(0, 4)}-${x.date.slice(4, 6)}-${x.date.slice(6, 8)}`;
          const imp = Number(x.video_thumbnail_impressions) || 0;
          const ctr = (Number(x.video_thumbnail_impressions_ctr) || 0) / (percentScale ? 100 : 1);
          const k = `${x.video_id}|${day}`;
          const cur = agg.get(k) ?? { video_id: x.video_id, day, impressions: 0, clicks: 0 };
          cur.impressions += imp;
          cur.clicks += imp * ctr;
          agg.set(k, cur);
        }
        const out = [...agg.values()].map((a) => ({
          user_channel_id: t.user_channel_id,
          video_id: a.video_id,
          day: a.day,
          impressions: a.impressions,
          ctr: a.impressions > 0 ? Number((a.clicks / a.impressions).toFixed(5)) : null,
        }));
        for (let i = 0; i < out.length; i += 500) {
          const { error: upErr } = await db.from('video_reach_daily').upsert(out.slice(i, i + 500), { onConflict: 'user_channel_id,video_id,day' });
          if (upErr) throw new Error(upErr.message);
        }
        res.files++;
        res.rows += out.length;
        last = r.createTime;
      }
      await db.from('reporting_jobs').update({ last_report_created: last, last_sync_at: new Date().toISOString(), last_error: null }).eq('user_channel_id', t.user_channel_id);
    } catch (e) {
      const msg = (e as Error).message;
      res.errors.push(msg);
      await db.from('reporting_jobs').update({ last_error: msg.slice(0, 300), last_sync_at: new Date().toISOString() }).eq('user_channel_id', t.user_channel_id);
    }
  }
  return res;
}

export interface VideoReach {
  impressions: number;
  ctr: number | null;
  first_day: string;
  last_day: string;
  daily: { day: string; impressions: number; ctr: number | null }[];
}

/** Total des impressions et CTR pondéré d'une vidéo, d'après les fichiers déjà importés. */
export async function getVideoReach(db: SupabaseClient, userChannelId: string, videoId: string): Promise<VideoReach | null> {
  const { data } = await db
    .from('video_reach_daily')
    .select('day, impressions, ctr')
    .eq('user_channel_id', userChannelId)
    .eq('video_id', videoId)
    .order('day', { ascending: true })
    .limit(400);
  const rows = (data ?? []) as { day: string; impressions: number; ctr: number | null }[];
  if (!rows.length) return null;
  const imp = rows.reduce((a, r) => a + Number(r.impressions), 0);
  const clicks = rows.reduce((a, r) => a + Number(r.impressions) * Number(r.ctr ?? 0), 0);
  return {
    impressions: imp,
    ctr: imp > 0 ? Number((clicks / imp).toFixed(5)) : null,
    first_day: rows[0].day,
    last_day: rows[rows.length - 1].day,
    daily: rows.map((r) => ({ day: r.day, impressions: Number(r.impressions), ctr: r.ctr === null ? null : Number(r.ctr) })),
  };
}
