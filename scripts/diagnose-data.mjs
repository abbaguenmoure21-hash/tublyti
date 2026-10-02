// Diagnostic read-only de la base TubLyTI. N'écrit rien en base.
// Usage : node scripts/diagnose-data.mjs   → écrit design/diagnostic.md
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env.local' });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const out = [];
const p = (s = '') => out.push(s);
const since = (days) => new Date(Date.now() - days * 86400000).toISOString();

async function count(table, build = (q) => q) {
  try {
    const { count, error } = await build(db.from(table).select('*', { count: 'exact', head: true }));
    return error ? `ERR ${error.message}` : count;
  } catch (e) { return `ERR ${e.message}`; }
}
async function rows(table, cols, build = (q) => q, limit = 1000) {
  const all = [];
  for (let from = 0; ; from += limit) {
    const { data, error } = await build(db.from(table).select(cols)).range(from, from + limit - 1);
    if (error) { p(`> Erreur ${table}: ${error.message}`); break; }
    all.push(...data);
    if (data.length < limit || all.length >= 20000) break;
  }
  return all;
}
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

p(`# Diagnostic TubLyTI — ${new Date().toISOString()}`);
p('\n## Volumes');
for (const t of ['niches', 'channels', 'candidate_channels', 'videos', 'video_snapshots', 'comments', 'comment_labels', 'topics', 'topic_queries', 'topic_scores', 'trend_points', 'angles', 'jobs'])
  p(`- ${t}: ${await count(t)}`);
p(`- vidéos publiées < 90 j : ${await count('videos', (q) => q.gte('published_at', since(90)))}`);
p(`- vidéos rattachées à un sujet : ${await count('videos', (q) => q.not('topic_id', 'is', null))}`);
p(`- vidéos qualifiées : ${await count('videos', (q) => q.eq('is_qualified', true))}`);

const niches = await rows('niches', 'id,name');
const nicheName = Object.fromEntries(niches.map((n) => [n.id, n.name]));
const channels = await rows('channels', 'id,title,niche_id,subscriber_count,status,last_checked_at');
p('\n## Chaînes suivies par niche');
p('| Niche | Chaînes | Abonnés médians | < 10 k abonnés | Jamais vérifiées |');
p('| --- | --- | --- | --- | --- |');
for (const n of niches) {
  const c = channels.filter((x) => x.niche_id === n.id);
  p(`| ${n.name} | ${c.length} | ${med(c.map((x) => x.subscriber_count))} | ${c.filter((x) => (x.subscriber_count ?? 0) < 10000).length} | ${c.filter((x) => !x.last_checked_at).length} |`);
}
p(`- Chaînes sans niche : ${channels.filter((x) => !x.niche_id).length}`);

const vids = await rows('videos', 'id,channel_id,topic_id,title,published_at,duration_s,is_qualified', (q) => q.gte('published_at', since(90)));
const chById = Object.fromEntries(channels.map((c) => [c.id, c]));
p('\n## Vidéos des 90 derniers jours par niche');
p('| Niche | Vidéos | Longues (≥ 8 min) | Shorts (< 61 s) | Rattachées à un sujet | Qualifiées |');
p('| --- | --- | --- | --- | --- | --- |');
for (const n of niches) {
  const v = vids.filter((x) => chById[x.channel_id]?.niche_id === n.id);
  p(`| ${n.name} | ${v.length} | ${v.filter((x) => (x.duration_s ?? 0) >= 480).length} | ${v.filter((x) => (x.duration_s ?? 9999) < 61).length} | ${v.filter((x) => x.topic_id).length} | ${v.filter((x) => x.is_qualified).length} |`);
}

const topics = await rows('topics', 'id,label,niche_id,status,phase,created_at');
p('\n## Sujets');
const byStatus = {};
topics.forEach((t) => { byStatus[t.status] = (byStatus[t.status] ?? 0) + 1; });
p(`- Par statut : ${JSON.stringify(byStatus)}`);
const vidCount = {};
vids.forEach((v) => { if (v.topic_id) vidCount[v.topic_id] = (vidCount[v.topic_id] ?? 0) + 1; });
const lastDate = (await rows('topic_scores', 'scored_at', (q) => q.order('scored_at', { ascending: false }), 1))[0]?.scored_at;
p(`- Dernier calcul de score : ${lastDate}`);
const scores = lastDate ? await rows('topic_scores', 'topic_id,mgi,demand,frustration,supply_q,phase,confidence', (q) => q.eq('scored_at', lastDate)) : [];
const sc = Object.fromEntries(scores.map((s) => [s.topic_id, s]));
for (const n of niches) {
  const t = topics.filter((x) => x.niche_id === n.id && x.status !== 'rejected' && x.status !== 'merged')
    .sort((a, b) => (sc[b.id]?.mgi ?? -1) - (sc[a.id]?.mgi ?? -1)).slice(0, 15);
  p(`\n### ${n.name} — top 15 sujets`);
  p('| Sujet | Statut | MGI | Demande | Frustration | Offre | Phase | Confiance | Vidéos 90 j |');
  p('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  t.forEach((x) => { const s = sc[x.id] ?? {}; p(`| ${x.label} | ${x.status} | ${s.mgi ?? ''} | ${s.demand ?? ''} | ${s.frustration ?? ''} | ${s.supply_q ?? ''} | ${s.phase ?? ''} | ${s.confidence ?? ''} | ${vidCount[x.id] ?? 0} |`); });
}

p('\n## Commentaires et frustrations');
p(`- Commentaires < 60 j : ${await count('comments', (q) => q.gte('published_at', since(60)))}`);
const labels = await rows('comment_labels', 'label,confidence');
const lc = {}; labels.forEach((l) => { lc[l.label] = (lc[l.label] ?? 0) + 1; });
p(`- Labels : ${JSON.stringify(lc)}`);

p('\n## Candidates (découverte)');
const cand = await rows('candidate_channels', 'id,title,subscriber_count,median_views,discovered_via,status,auto_decision,niche_id');
const g = {};
cand.forEach((c) => { const k = `${c.discovered_via}/${c.auto_decision ?? 'manuel'}/${c.status}`; g[k] = (g[k] ?? 0) + 1; });
p('```\n' + Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}\t${k}`).join('\n') + '\n```');
p('Échantillon de 25 candidates acceptées ou en attente :');
cand.filter((c) => c.status !== 'ignored' && c.auto_decision !== 'rejected').slice(0, 25)
  .forEach((c) => p(`- ${c.title} · ${c.subscriber_count} abonnés · médiane ${c.median_views} · ${c.discovered_via} · ${nicheName[c.niche_id] ?? '?'}`));

p('\n## Vidéos découvertes par recherche (hors chaînes suivies)');
const orphan = vids.filter((v) => !chById[v.channel_id]);
p(`- ${orphan.length} vidéos de chaînes non suivies sur 90 j`);
orphan.slice(0, 15).forEach((v) => p(`- ${v.title}`));

p('\n## 15 derniers jobs');
const jobs = await rows('jobs', 'kind,started_at,finished_at,quota_used,items_processed,error', (q) => q.order('started_at', { ascending: false }), 15);
jobs.slice(0, 15).forEach((j) => p(`- ${j.started_at?.slice(0, 16)} ${j.kind} · quota ${j.quota_used} · items ${j.items_processed} · ${j.finished_at ? 'fini' : 'NON TERMINÉ'} ${j.error ? '· ERREUR ' + j.error.slice(0, 140) : ''}`));

fs.mkdirSync('design', { recursive: true });
fs.writeFileSync('design/diagnostic.md', out.join('\n'));
console.log('OK → design/diagnostic.md');
