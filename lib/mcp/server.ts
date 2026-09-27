import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';

export function createMcpServer(): McpServer {
  const mcp = new McpServer({
    name: 'TubLyTI',
    version: '1.0.0',
  });

  // ── Tool 1: list_opportunities ──────────────────────────────────

  mcp.tool(
    'list_opportunities',
    'List YouTube opportunity topics sorted by MGI score, with demand/supply/frustration components and phase.',
    {
      niche: z.string().describe('Niche name to filter (e.g. "finance", "psychology", "ai_tools")'),
      limit: z.number().optional().describe('Max results (default 10, max 50)'),
      phase: z.number().optional().describe('Filter by phase (0=emergence, 1=short virality, 2=ideal window, 3=saturation)'),
    },
    async ({ niche, limit, phase }) => {
      const db = createServiceClient();
      const today = new Date().toISOString().slice(0, 10);
      const maxResults = Math.min(limit ?? 10, 50);

      // Find niche
      const { data: nicheRow } = await db
        .from('niches')
        .select('id, name')
        .ilike('name', `%${niche}%`)
        .limit(1)
        .single();

      if (!nicheRow) {
        return { content: [{ type: 'text' as const, text: `Niche "${niche}" introuvable.` }] };
      }

      // Get scored topics
      let query = db
        .from('topic_scores')
        .select('mgi, demand, frustration, supply_q, monetization, phase, topic_id, topics!inner(id, label, status, niche_id)')
        .eq('topics.niche_id', nicheRow.id)
        .eq('scored_at', today)
        .order('mgi', { ascending: false })
        .limit(maxResults);

      if (phase !== undefined) {
        query = query.eq('phase', phase);
      }

      const { data: scores, error } = await query;

      if (error) {
        return { content: [{ type: 'text' as const, text: `Erreur: ${error.message}` }], isError: true };
      }

      if (!scores || scores.length === 0) {
        return { content: [{ type: 'text' as const, text: `Aucun sujet score pour la niche "${nicheRow.name}" aujourd'hui.` }] };
      }

      const PHASE_LABELS: Record<number, string> = {
        0: 'Emergence',
        1: 'Viralite courte',
        2: 'Fenetre ideale',
        3: 'Saturation',
      };

      const lines = scores.map((s: Record<string, unknown>, i: number) => {
        const topic = s.topics as unknown as { id: string; label: string; status: string };
        const p = s.phase as number;
        return [
          `${i + 1}. **${topic.label}** (MGI ${(s.mgi as number).toFixed(1)})`,
          `   ID: ${topic.id} | Status: ${topic.status}`,
          `   D=${(s.demand as number).toFixed(0)} F=${((s.frustration as number) * 100).toFixed(0)}% O_q=${(s.supply_q as number).toFixed(1)} P=x${(s.monetization as number).toFixed(1)}`,
          `   Phase ${p}: ${PHASE_LABELS[p] ?? '?'}`,
        ].join('\n');
      });

      return {
        content: [{
          type: 'text' as const,
          text: `# Opportunites — ${nicheRow.name} (${scores.length} sujets)\n\n${lines.join('\n\n')}`,
        }],
      };
    },
  );

  // ── Tool 2: get_topic ───────────────────────────────────────────

  mcp.tool(
    'get_topic',
    'Get full details for a topic: scores, top 20 frustrations, competitors, and generated angles.',
    {
      topic_id: z.string().describe('UUID of the topic'),
    },
    async ({ topic_id }) => {
      const db = createServiceClient();
      const today = new Date().toISOString().slice(0, 10);

      // Topic
      const { data: topic, error: topicErr } = await db
        .from('topics')
        .select('id, label, phase, status, niches(name, rpm_coefficient)')
        .eq('id', topic_id)
        .single();

      if (topicErr || !topic) {
        return { content: [{ type: 'text' as const, text: 'Sujet introuvable.' }], isError: true };
      }

      const niche = topic.niches as unknown as { name: string; rpm_coefficient: number };

      // Score
      const { data: score } = await db
        .from('topic_scores')
        .select('mgi, demand, frustration, supply_q, monetization, phase')
        .eq('topic_id', topic_id)
        .eq('scored_at', today)
        .single();

      // Frustrations
      const { data: frustRows } = await db
        .from('comment_labels')
        .select(`
          label, requested_angle, confidence,
          comments!inner(text, like_count, videos!inner(topic_id))
        `)
        .eq('comments.videos.topic_id', topic_id)
        .neq('label', 'none')
        .gte('confidence', 0.7)
        .order('comments(like_count)', { ascending: false })
        .limit(20);

      // Competitors
      const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString();
      const { data: vids } = await db
        .from('videos')
        .select('title, channels(title)')
        .eq('topic_id', topic_id)
        .eq('is_qualified', true)
        .gte('published_at', sixMonthsAgo)
        .order('published_at', { ascending: false })
        .limit(10);

      // Angles
      const { data: angles } = await db
        .from('angles')
        .select('id, title, hook, rationale, status')
        .eq('topic_id', topic_id)
        .order('created_at', { ascending: false });

      // Build output
      const PHASE_LABELS: Record<number, string> = {
        0: 'Emergence', 1: 'Viralite courte', 2: 'Fenetre ideale', 3: 'Saturation',
      };

      const sections: string[] = [];

      // Header
      const phase = score?.phase ?? topic.phase;
      sections.push(
        `# ${topic.label}`,
        `Niche: ${niche?.name ?? '?'} (RPM x${niche?.rpm_coefficient ?? '?'})`,
        `Status: ${topic.status} | Phase: ${phase !== null ? `${phase} — ${PHASE_LABELS[phase as number] ?? '?'}` : 'inconnue'}`,
      );

      // Score
      if (score) {
        sections.push(
          '',
          '## Scores',
          `- MGI: **${(score.mgi as number).toFixed(1)}**`,
          `- Demande (D): ${(score.demand as number).toFixed(0)}`,
          `- Frustration (F): ${((score.frustration as number) * 100).toFixed(0)}%`,
          `- Offre qualifiee (O_q): ${(score.supply_q as number).toFixed(1)}`,
          `- Monetisation (P): x${(score.monetization as number).toFixed(1)}`,
        );
      }

      // Frustrations
      sections.push('', `## Frustrations (${(frustRows ?? []).length})`);
      for (const f of frustRows ?? []) {
        const c = (f as Record<string, unknown>).comments as unknown as { text: string; like_count: number };
        const angle = f.requested_angle ? ` → ${f.requested_angle}` : '';
        sections.push(`- [${c.like_count} likes] ${c.text.slice(0, 200)}${angle}`);
      }

      // Competitors
      sections.push('', `## Concurrents (${(vids ?? []).length})`);
      for (const v of vids ?? []) {
        const ch = (v as Record<string, unknown>).channels as unknown as { title: string };
        sections.push(`- ${v.title} (${ch?.title ?? '?'})`);
      }

      // Angles
      sections.push('', `## Angles (${(angles ?? []).length})`);
      for (const a of angles ?? []) {
        sections.push(`- **${a.title}** [${a.status}]`, `  Hook: ${a.hook}`, `  Rationale: ${a.rationale}`);
      }

      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
      };
    },
  );

  // ── Tool 3: mark_in_production ──────────────────────────────────

  mcp.tool(
    'mark_in_production',
    'Mark a topic as "in_production" and optionally select an angle.',
    {
      topic_id: z.string().describe('UUID of the topic to mark'),
      angle_id: z.string().optional().describe('UUID of the angle to select (optional)'),
    },
    async ({ topic_id, angle_id }) => {
      const db = createServiceClient();

      // Check topic exists
      const { data: topic, error: topicErr } = await db
        .from('topics')
        .select('id, label, status')
        .eq('id', topic_id)
        .single();

      if (topicErr || !topic) {
        return { content: [{ type: 'text' as const, text: 'Sujet introuvable.' }], isError: true };
      }

      if (topic.status !== 'active') {
        return {
          content: [{
            type: 'text' as const,
            text: `Impossible : le sujet "${topic.label}" est deja en status "${topic.status}".`,
          }],
          isError: true,
        };
      }

      // Update topic
      const { error: updateErr } = await db
        .from('topics')
        .update({ status: 'in_production' })
        .eq('id', topic_id);

      if (updateErr) {
        return { content: [{ type: 'text' as const, text: `Erreur: ${updateErr.message}` }], isError: true };
      }

      // Select angle if provided
      if (angle_id) {
        await db
          .from('angles')
          .update({ status: 'in_production' })
          .eq('id', angle_id)
          .eq('topic_id', topic_id);
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Le sujet "${topic.label}" est maintenant en production.${angle_id ? ` Angle ${angle_id} selectionne.` : ''}`,
        }],
      };
    },
  );

  return mcp;
}
