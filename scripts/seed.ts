import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { RealYouTubeClient } from '../lib/youtube/client';

// Load .env.local if present (scripts run outside Next.js)
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── CSV parser (handles quoted fields, no dependency) ────────────────
function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n');
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const values = splitCSVLine(line);
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

  // ── 0. Rename old niches if they exist ──────────────────────────
  const renames: [string, string][] = [
    ['Dividend & passive income investing', 'Personal Finance & Investing'],
    ['Cognitive biases & self-mastery', 'Psychology & Self-Improvement'],
    ['AI agents & automation tools', 'AI Tools & Automation'],
  ];
  for (const [oldName, newName] of renames) {
    const { data: old } = await db.from('niches').select('id').eq('name', oldName).single();
    if (old) {
      await db.from('niches').update({ name: newName }).eq('id', old.id);
      console.log(`  Renamed: ${oldName} → ${newName}`);
    }
  }

  // ── 1. Niches ───────────────────────────────────────────────────
  console.log('Seeding niches...');
  const niches = parseCSV(readFileSync(resolve(seedDir, 'niches.csv'), 'utf-8'));
  const nicheMap = new Map<string, string>(); // name → id

  for (const n of niches) {
    // Core fields (always present in schema)
    const corePayload = {
      name: n.name,
      category: n.category,
      rpm_coefficient: parseFloat(n.rpm_coefficient),
      owner_channel: n.owner_channel || null,
      workspace_id: '00000000-0000-0000-0000-000000000001',
    };

    // RPM detail fields (added in migration 00004, may not exist yet)
    const rpmPayload = {
      rpm_low: n.rpm_low ? parseFloat(n.rpm_low) : null,
      rpm_high: n.rpm_high ? parseFloat(n.rpm_high) : null,
      rpm_source: n.rpm_source || null,
    };

    // Check if niche already exists by name
    const { data: existing } = await db
      .from('niches')
      .select('id, name')
      .eq('name', n.name)
      .single();

    let nicheId: string;

    if (existing) {
      nicheId = existing.id;
      await db.from('niches').update(corePayload).eq('id', nicheId);
      nicheMap.set(existing.name, nicheId);
      console.log(`  ~ ${existing.name} (${nicheId}) updated`);
    } else {
      const { data: inserted, error: insertErr } = await db
        .from('niches')
        .insert(corePayload)
        .select('id, name')
        .single();

      if (insertErr) {
        console.error(`  Failed to insert niche ${n.name}: ${insertErr.message}`);
        continue;
      }
      nicheId = inserted!.id;
      nicheMap.set(inserted!.name, nicheId);
      console.log(`  + ${inserted!.name} (${nicheId})`);
    }

    // Try to set RPM details (silently skip if columns don't exist)
    if (rpmPayload.rpm_low !== null) {
      const { error: rpmErr } = await db.from('niches').update(rpmPayload).eq('id', nicheId);
      if (rpmErr && !rpmErr.message.includes('column')) {
        console.error(`  RPM update failed for ${n.name}: ${rpmErr.message}`);
      }
    }
  }

  // ── 2. Channels ─────────────────────────────────────────────────
  console.log('\nSeeding channels...');
  const channelsFile = process.argv[2] || 'channels.csv';
  const channelsCSV = parseCSV(readFileSync(resolve(seedDir, channelsFile), 'utf-8'));

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

    // Check if topic already exists for this label + niche
    const { data: existingTopic } = await db
      .from('topics')
      .select('id')
      .eq('label', q.query_text)
      .eq('niche_id', nicheId)
      .single();

    let topicId: string;
    if (existingTopic) {
      topicId = existingTopic.id;
      console.log(`  ~ ${q.query_text} (exists)`);
    } else {
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
      topicId = topic!.id;
    }

    // Check if query already exists
    const { data: existingQuery } = await db
      .from('topic_queries')
      .select('id')
      .eq('topic_id', topicId)
      .eq('source', q.source)
      .eq('query_text', q.query_text)
      .single();

    if (existingQuery) continue;

    const { error: queryErr } = await db.from('topic_queries').insert({
      workspace_id: '00000000-0000-0000-0000-000000000001',
      topic_id: topicId,
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
