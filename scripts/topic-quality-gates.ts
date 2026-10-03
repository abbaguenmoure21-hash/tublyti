/**
 * Topic quality gates:
 *   1. Flag sensitive topics (non-monetizable / brand-risky)
 *   2. Reject topics where > 70% of videos come from a single channel
 *
 * Usage:
 *   npx tsx scripts/topic-quality-gates.ts --dry-run    # show what would change (default)
 *   npx tsx scripts/topic-quality-gates.ts --apply       # apply changes
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

import { isSensitiveTopic } from '../lib/topics/sensitive';

const DRY_RUN = !process.argv.includes('--apply');
const SINGLE_CHANNEL_THRESHOLD = 0.70;

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log(`\n=== Topic Quality Gates ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===\n`);

  const { data: niches } = await db.from('niches').select('id, name');
  const nicheNames = new Map((niches ?? []).map((n) => [n.id, n.name]));

  const { data: topics } = await db
    .from('topics')
    .select('id, label, niche_id, status')
    .in('status', ['proposed', 'active', 'in_production']);

  if (!topics?.length) {
    console.log('No active topics found.');
    return;
  }

  // ── Gate 1: Sensitive topics ──────────────────────────────────────
  console.log('--- Gate 1: Sensitive Topics ---');
  const sensitiveTopics: { id: string; label: string; niche: string }[] = [];

  for (const t of topics) {
    if (isSensitiveTopic(t.label)) {
      sensitiveTopics.push({
        id: t.id,
        label: t.label,
        niche: nicheNames.get(t.niche_id) ?? 'Unknown',
      });
    }
  }

  if (sensitiveTopics.length === 0) {
    console.log('  Aucun sujet sensible détecté.\n');
  } else {
    for (const t of sensitiveTopics) {
      console.log(`  ⚠ [${t.niche}] ${t.label}`);
    }
    console.log(`  Total: ${sensitiveTopics.length} sujets sensibles\n`);
  }

  // ── Gate 2: Single-channel dominance (> 70%) ──────────────────────
  console.log('--- Gate 2: Single-Channel Dominance (> 70%) ---');
  const toReject: { id: string; label: string; niche: string; topChannel: string; pct: number; videoCount: number }[] = [];

  for (const t of topics) {
    const { data: videos } = await db
      .from('videos')
      .select('channel_id')
      .eq('topic_id', t.id);

    if (!videos || videos.length < 3) continue;

    const channelCounts = new Map<string, number>();
    for (const v of videos) {
      channelCounts.set(v.channel_id, (channelCounts.get(v.channel_id) ?? 0) + 1);
    }

    const topCount = Math.max(...channelCounts.values());
    const topChannel = [...channelCounts.entries()].find(([, c]) => c === topCount)?.[0] ?? '';
    const pct = topCount / videos.length;

    if (pct > SINGLE_CHANNEL_THRESHOLD) {
      toReject.push({
        id: t.id,
        label: t.label,
        niche: nicheNames.get(t.niche_id) ?? 'Unknown',
        topChannel,
        pct,
        videoCount: videos.length,
      });
    }
  }

  if (toReject.length === 0) {
    console.log('  Aucun sujet mono-chaîne détecté.\n');
  } else {
    for (const t of toReject) {
      console.log(`  ✗ [${t.niche}] "${t.label}" — ${(t.pct * 100).toFixed(0)}% from 1 channel (${t.videoCount} videos)`);
    }
    console.log(`  Total: ${toReject.length} sujets à rejeter\n`);
  }

  // ── Apply ──────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    // Reject single-channel-dominated topics
    if (toReject.length > 0) {
      const rejectIds = toReject.map((t) => t.id);
      const { error } = await db.from('topics').update({ status: 'rejected' }).in('id', rejectIds);
      if (error) {
        console.error('Reject error:', error.message);
      } else {
        console.log(`${rejectIds.length} sujets mono-chaîne rejetés.`);
      }
    }

    // Note: sensitive topics are NOT rejected — they stay visible with a badge.
    // The filtering is done at query/display time.
    if (sensitiveTopics.length > 0) {
      console.log(`${sensitiveTopics.length} sujets marqués sensibles (filtrage côté affichage).`);
    }
  } else {
    console.log('(DRY RUN — relancer avec --apply pour appliquer)');
  }
}

main().catch(console.error);
