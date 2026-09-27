import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { RealYouTubeClient } from '../lib/youtube/client';

// ── CSV parser (simple, no dependency) ──────────────────────────────
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    return row;
  });
}

// ── Extract handle or channel ID from URL ───────────────────────────
function parseChannelInput(input: string): { type: 'handle' | 'id'; value: string } {
  // https://www.youtube.com/@Handle
  const handleMatch = input.match(/@([\w.-]+)/);
  if (handleMatch) return { type: 'handle', value: handleMatch[1] };

  // https://www.youtube.com/channel/UCxxxxx
  const idMatch = input.match(/channel\/(UC[\w-]+)/);
  if (idMatch) return { type: 'id', value: idMatch[1] };

  // Bare channel ID
  if (input.startsWith('UC')) return { type: 'id', value: input };

  // Treat as handle
  return { type: 'handle', value: input.replace('@', '') };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey);
  const yt = new RealYouTubeClient();

  const seedDir = resolve(process.cwd(), 'seed');

  // ── 1. Niches ───────────────────────────────────────────────────
  console.log('Seeding niches...');
  const niches = parseCSV(readFileSync(resolve(seedDir, 'niches.csv'), 'utf-8'));
  const nicheMap = new Map<string, string>(); // name → id

  for (const n of niches) {
    const { data, error } = await db
      .from('niches')
      .upsert(
        {
          name: n.name,
          category: n.category,
          rpm_coefficient: parseFloat(n.rpm_coefficient),
          owner_channel: n.owner_channel || null,
          workspace_id: '00000000-0000-0000-0000-000000000001',
        },
        { onConflict: 'id' },
      )
      .select('id, name')
      .single();

    if (error) {
      // Try insert instead (first time)
      const { data: inserted, error: insertErr } = await db
        .from('niches')
        .insert({
          name: n.name,
          category: n.category,
          rpm_coefficient: parseFloat(n.rpm_coefficient),
          owner_channel: n.owner_channel || null,
          workspace_id: '00000000-0000-0000-0000-000000000001',
        })
        .select('id, name')
        .single();

      if (insertErr) {
        console.error(`  Failed to insert niche ${n.name}: ${insertErr.message}`);
        continue;
      }
      nicheMap.set(inserted!.name, inserted!.id);
      console.log(`  + ${inserted!.name} (${inserted!.id})`);
    } else {
      nicheMap.set(data.name, data.id);
      console.log(`  + ${data.name} (${data.id})`);
    }
  }

  // ── 2. Channels ─────────────────────────────────────────────────
  console.log('\nSeeding channels...');
  const channelsCSV = parseCSV(readFileSync(resolve(seedDir, 'channels.csv'), 'utf-8'));

  const handleEntries: { handle: string; niche: string }[] = [];
  const idEntries: { id: string; niche: string }[] = [];

  for (const row of channelsCSV) {
    const parsed = parseChannelInput(row.channel_url_or_id);
    if (parsed.type === 'handle') {
      handleEntries.push({ handle: parsed.value, niche: row.niche });
    } else {
      idEntries.push({ id: parsed.value, niche: row.niche });
    }
  }

  // Resolve handles
  if (handleEntries.length > 0) {
    console.log(`  Resolving ${handleEntries.length} handle(s)...`);
    const resolved = await yt.resolveHandles(handleEntries.map((h) => h.handle));
    for (let i = 0; i < resolved.length; i++) {
      const nicheId = nicheMap.get(handleEntries[i].niche);
      if (!nicheId) {
        console.error(`  Niche not found: ${handleEntries[i].niche}`);
        continue;
      }
      const { error } = await db.from('channels').upsert({
        id: resolved[i].id,
        workspace_id: '00000000-0000-0000-0000-000000000001',
        niche_id: nicheId,
        title: resolved[i].title,
        subscriber_count: resolved[i].subscriberCount,
        uploads_playlist_id: resolved[i].uploadsPlaylistId,
      });
      if (error) {
        console.error(`  Failed: ${resolved[i].title}: ${error.message}`);
      } else {
        console.log(`  + ${resolved[i].title} (${resolved[i].id})`);
      }
    }
  }

  // Direct IDs in batches of 50
  if (idEntries.length > 0) {
    console.log(`  Fetching ${idEntries.length} channel(s) by ID...`);
    for (let i = 0; i < idEntries.length; i += 50) {
      const batch = idEntries.slice(i, i + 50);
      const infos = await yt.getChannels(batch.map((e) => e.id));
      for (let j = 0; j < infos.length; j++) {
        const nicheId = nicheMap.get(batch[j].niche);
        if (!nicheId) continue;
        const { error } = await db.from('channels').upsert({
          id: infos[j].id,
          workspace_id: '00000000-0000-0000-0000-000000000001',
          niche_id: nicheId,
          title: infos[j].title,
          subscriber_count: infos[j].subscriberCount,
          uploads_playlist_id: infos[j].uploadsPlaylistId,
        });
        if (error) {
          console.error(`  Failed: ${infos[j].title}: ${error.message}`);
        } else {
          console.log(`  + ${infos[j].title} (${infos[j].id})`);
        }
      }
    }
  }

  // ── 3. Queries → Topics ─────────────────────────────────────────
  console.log('\nSeeding queries and topics...');
  const queries = parseCSV(readFileSync(resolve(seedDir, 'queries.csv'), 'utf-8'));

  for (const q of queries) {
    const nicheId = nicheMap.get(q.niche);
    if (!nicheId) {
      console.error(`  Niche not found: ${q.niche}`);
      continue;
    }

    // Create a topic for each unique query_text (simplified for seeds)
    const { data: topic, error: topicErr } = await db
      .from('topics')
      .insert({
        workspace_id: '00000000-0000-0000-0000-000000000001',
        niche_id: nicheId,
        label: q.query_text,
        status: 'active',
      })
      .select('id')
      .single();

    if (topicErr) {
      console.error(`  Failed topic ${q.query_text}: ${topicErr.message}`);
      continue;
    }

    const { error: queryErr } = await db.from('topic_queries').insert({
      workspace_id: '00000000-0000-0000-0000-000000000001',
      topic_id: topic!.id,
      source: q.source,
      query_text: q.query_text,
      priority: parseInt(q.priority ?? '1', 10),
    });

    if (queryErr) {
      console.error(`  Failed query ${q.query_text}: ${queryErr.message}`);
    } else {
      console.log(`  + ${q.source}:${q.query_text}`);
    }
  }

  console.log(`\nDone. Quota used: ${yt.getQuotaUsed()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
