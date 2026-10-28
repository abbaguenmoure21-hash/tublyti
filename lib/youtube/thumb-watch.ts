import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Étape de nuit « thumb-watch » : détecte les miniatures changées.
 * Pour les vidéos des 45 derniers jours, on télécharge la petite miniature (≈ 15 Ko),
 * on compare son empreinte à celle de la veille, et on archive chaque version dans le stockage
 * « thumbnails » (<vidéo>/<empreinte>.jpg) pour l'affichage avant / après.
 */

const BUCKET = 'thumbnails';

export interface ThumbWatchResult {
  checked: number;
  changed: number;
  archived: number;
  errors: number;
}

function publicUrl(db: SupabaseClient, path: string): string {
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function runThumbWatch(db: SupabaseClient, deadline: number, limit = 2500): Promise<ThumbWatchResult> {
  const res: ThumbWatchResult = { checked: 0, changed: 0, archived: 0, errors: 0 };
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const { data, error } = await db
    .from('videos')
    .select('id, thumb_hash')
    .gte('published_at', since)
    .order('thumb_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`videos : ${error.message}`);
  const list = (data ?? []) as { id: string; thumb_hash: string | null }[];

  let next = 0;
  async function worker() {
    while (next < list.length && Date.now() < deadline) {
      const v = list[next++];
      try {
        const r = await fetch(`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        if (!r.ok) {
          res.errors++;
          continue;
        }
        const buf = Buffer.from(await r.arrayBuffer());
        const hash = createHash('sha1').update(buf).digest('hex').slice(0, 16);
        res.checked++;
        const now = new Date().toISOString();
        if (v.thumb_hash === hash) {
          await db.from('videos').update({ thumb_checked_at: now }).eq('id', v.id);
          continue;
        }
        const path = `${v.id}/${hash}.jpg`;
        const up = await db.storage.from(BUCKET).upload(path, buf, { contentType: 'image/jpeg', upsert: true });
        if (!up.error) res.archived++;
        if (v.thumb_hash) {
          // Vues au moment du changement (dernier relevé connu).
          const { data: snap } = await db.from('video_snapshots').select('views').eq('video_id', v.id).order('captured_at', { ascending: false }).limit(1).maybeSingle();
          await db.from('video_events').insert({
            workspace_id: '00000000-0000-0000-0000-000000000001',
            video_id: v.id,
            event_type: 'thumbnail_change',
            old_value: publicUrl(db, `${v.id}/${v.thumb_hash}.jpg`),
            new_value: publicUrl(db, path),
            meta: { old_hash: v.thumb_hash, new_hash: hash, views_at_change: snap?.views ?? null },
          });
          res.changed++;
        }
        await db.from('videos').update({ thumb_hash: hash, thumb_checked_at: now }).eq('id', v.id);
      } catch {
        res.errors++;
      }
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  return res;
}
