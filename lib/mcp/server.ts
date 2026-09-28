import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveNiche } from '@/lib/niches/resolve';
import { getLatestScoreDate } from '@/lib/scoring/latest-score-date';
import { checkRateLimit } from './rate-limit';
import { canWrite, type McpTokenInfo } from './auth';
import { escapeLike } from '@/lib/utils';

// ── Constants ──────────────────────────────────────────────────────────

const PHASE_LABELS: Record<number, string> = {
  0: 'Emergence',
  1: 'Viralite courte',
  2: 'Fenetre ideale',
  3: 'Saturation',
};

function phaseLabel(p: number | null | undefined): string {
  if (p == null) return 'inconnue';
  return PHASE_LABELS[p] ?? `Phase ${p}`;
}

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return Number(n).toFixed(decimals);
}

// ── Helpers ────────────────────────────────────────────────────────────

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(text: string): TextResult {
  return { content: [{ type: 'text' as const, text }] };
}

function fail(text: string): TextResult {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

async function guard(
  token: McpTokenInfo,
  toolName: string,
  opts?: { write?: boolean },
): Promise<string | null> {
  if (opts?.write && !canWrite(token)) {
    return 'Acces refuse : ce jeton est en lecture seule. Cree un jeton lecture/ecriture dans Reglages > Acces API.';
  }
  const rl = await checkRateLimit(token.id, toolName);
  if (!rl.allowed) {
    return `Plafond quotidien atteint pour ${toolName} (${rl.limit}/jour). Les compteurs sont reinitialises a minuit UTC.`;
  }
  return null;
}

async function resolveNicheOrFail(db: ReturnType<typeof createServiceClient>, query: string) {
  const { data: allNiches } = await db
    .from('niches')
    .select('id, name, category, owner_channel');
  return resolveNiche(query, allNiches ?? []);
}

// ── Server factory ─────────────────────────────────────────────────────

export function createMcpServer(token: McpTokenInfo): McpServer {
  const mcp = new McpServer({
    name: 'TubLyTI',
    version: '2.0.0',
  });

  // ────────────────────────────────────────────────────────────────────
  //  READ TOOLS
  // ────────────────────────────────────────────────────────────────────

  // ── list_niches ────────────────────────────────────────────────────

  mcp.tool(
    'list_niches',
    'Liste les niches configurees dans TubLyTI avec leur categorie, coefficient RPM et chaine liee. Utilise cet outil pour decouvrir les niches disponibles avant d\'appeler les autres outils.',
    {},
    async () => {
      const blocked = await guard(token, 'list_niches');
      if (blocked) return fail(blocked);

      const db = createServiceClient();
      const { data: niches } = await db
        .from('niches')
        .select('id, name, category, rpm_coefficient, owner_channel, status')
        .eq('status', 'active')
        .order('name');

      if (!niches?.length) return ok('Aucune niche configuree.');

      const lines = niches.map(
        (n: Record<string, unknown>) =>
          `- **${n.name}** (${n.category}) — RPM x${fmt(n.rpm_coefficient as number)} — Chaine : ${(n.owner_channel as string) || '—'}`,
      );

      return ok(`# Niches TubLyTI (${niches.length})\n\n${lines.join('\n')}`);
    },
  );

  // ── list_today ─────────────────────────────────────────────────────

  mcp.tool(
    'list_today',
    'Retourne le flux « Aujourd\'hui » : par chaine, les 3 meilleures opportunites (phase 2 d\'abord, puis MGI), avec la frustration principale. Utilise cet outil pour repondre a « Quoi tourner cette semaine ? ».',
    {},
    async () => {
      const blocked = await guard(token, 'list_today');
      if (blocked) return fail(blocked);

      const db = createServiceClient();
      const scoredAt = await getLatestScoreDate(db);

      const { data: channels } = await db
        .from('channels')
        .select('id, title, niche_id, niches(id, name)')
        .order('title');

      if (!channels?.length) return ok('Aucune chaine configuree.');

      const { data: allScores } = await db
        .from('topic_scores')
        .select('mgi, demand, frustration, supply_q, phase, topic_id, topics!inner(id, label, status, niche_id)')
        .eq('scored_at', scoredAt)
        .in('topics.status', ['active', 'in_production'])
        .order('mgi', { ascending: false });

      const scoresByNiche = new Map<string, { topicId: string; label: string; mgi: number; phase: number }[]>();
      for (const s of allScores ?? []) {
        const topic = s.topics as unknown as { id: string; label: string; niche_id: string };
        const nicheId = topic.niche_id;
        if (!scoresByNiche.has(nicheId)) scoresByNiche.set(nicheId, []);
        scoresByNiche.get(nicheId)!.push({
          topicId: topic.id,
          label: topic.label,
          mgi: Number(s.mgi),
          phase: s.phase as number,
        });
      }

      for (const [, topics] of scoresByNiche) {
        topics.sort((a, b) => {
          if (a.phase === 2 && b.phase !== 2) return -1;
          if (b.phase === 2 && a.phase !== 2) return 1;
          return b.mgi - a.mgi;
        });
      }

      const sections: string[] = [`# Aujourd'hui — scores du ${scoredAt}\n`];

      for (const ch of channels as unknown as { id: string; title: string; niche_id: string; niches: { id: string; name: string } | null }[]) {
        if (!ch.niches) continue;
        const topics = (scoresByNiche.get(ch.niche_id) ?? []).slice(0, 3);
        if (topics.length === 0) continue;

        sections.push(`## ${ch.title ?? ch.id} (${ch.niches.name})\n`);
        for (const t of topics) {
          sections.push(
            `- **${t.label}** — MGI ${Math.round(t.mgi)} — ${phaseLabel(t.phase)}`,
            `  ID: \`${t.topicId}\``,
          );
        }
        sections.push('');
      }

      return ok(sections.join('\n'));
    },
  );

  // ── list_opportunities ─────────────────────────────────────────────

  mcp.tool(
    'list_opportunities',
    'Liste les sujets d\'une niche tries par MGI avec les composantes (demande, offre, frustration, monetisation) et la phase. Utilise pour explorer une niche en detail. Accepte le nom, la categorie ou la chaine liee.',
    {
      niche: z.string().describe('Nom, categorie ou chaine liee de la niche'),
      limit: z.number().optional().describe('Nombre max de resultats (defaut 10, max 50)'),
      phase: z.number().optional().describe('Filtrer par phase (0=emergence, 1=viralite courte, 2=fenetre ideale, 3=saturation)'),
    },
    async ({ niche, limit, phase }) => {
      const blocked = await guard(token, 'list_opportunities');
      if (blocked) return fail(blocked);

      const db = createServiceClient();
      const maxResults = Math.min(limit ?? 10, 50);

      const resolved = await resolveNicheOrFail(db, niche);
      if (!resolved.niche) {
        return fail(`Niche « ${niche} » introuvable. Disponibles : ${resolved.available.join(', ')}.`);
      }
      const nicheRow = resolved.niche;
      const scoredAt = await getLatestScoreDate(db);

      let query = db
        .from('topic_scores')
        .select('mgi, demand, frustration, supply_q, monetization, phase, feasibility_grade, feasibility_reason, topic_id, topics!inner(id, label, status, niche_id)')
        .eq('topics.niche_id', nicheRow.id)
        .eq('scored_at', scoredAt)
        .order('mgi', { ascending: false })
        .limit(maxResults);

      if (phase !== undefined) {
        query = query.eq('phase', phase);
      }

      const { data: scores, error: qErr } = await query;
      if (qErr) return fail(`Erreur: ${qErr.message}`);
      if (!scores?.length) return ok(`Aucun sujet score pour la niche « ${nicheRow.name} ».`);

      const lines = scores.map((s: Record<string, unknown>, i: number) => {
        const topic = s.topics as unknown as { id: string; label: string; status: string };
        const p = s.phase as number;
        const fGrade = s.feasibility_grade ? ` | Fais. ${s.feasibility_grade}` : '';
        return [
          `${i + 1}. **${topic.label}** (MGI ${fmt(s.mgi as number)})`,
          `   ID: \`${topic.id}\` | ${topic.status} | ${phaseLabel(p)}${fGrade}`,
          `   D=${fmt(s.demand as number, 0)} F=${fmt((s.frustration as number) * 100, 0)}% Oq=${fmt(s.supply_q as number)} P=x${fmt(s.monetization as number)}`,
        ].join('\n');
      });

      return ok(`# Opportunites — ${nicheRow.name} (${scores.length} sujets, scores du ${scoredAt})\n\n${lines.join('\n\n')}`);
    },
  );

  // ── search_topics ──────────────────────────────────────────────────

  mcp.tool(
    'search_topics',
    'Recherche semantique de sujets par embedding (Voyage AI). Utilise quand l\'utilisateur decrit un sujet en langage naturel plutot que par son nom exact. Retourne les sujets les plus proches avec leur phase.',
    {
      query: z.string().describe('Description du sujet en langage naturel'),
      limit: z.number().optional().describe('Nombre max (defaut 10, max 20)'),
    },
    async ({ query, limit }) => {
      const blocked = await guard(token, 'search_topics');
      if (blocked) return fail(blocked);

      const maxResults = Math.min(limit ?? 10, 20);
      const voyageKey = process.env.VOYAGE_API_KEY;

      if (!voyageKey) {
        // Fallback to text search
        const db = createServiceClient();
        const { data: textResults } = await db
          .from('topics')
          .select('id, label, phase, status, niches(name)')
          .ilike('label', `%${escapeLike(query)}%`)
          .in('status', ['active', 'in_production', 'proposed'])
          .limit(maxResults);

        if (!textResults?.length) return ok(`Aucun sujet trouve pour « ${query} ».`);

        const lines = textResults.map((t: Record<string, unknown>) => {
          const niche = (t.niches as unknown as { name: string } | null)?.name ?? '';
          return `- **${t.label}** — ${phaseLabel(t.phase as number)} — ${niche} — ID: \`${t.id}\``;
        });
        return ok(`# Recherche : « ${query} » (${textResults.length} resultats, recherche textuelle)\n\n${lines.join('\n')}`);
      }

      const embedRes = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${voyageKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.EMBEDDING_MODEL ?? 'voyage-4-lite',
          input: [query],
          input_type: 'query',
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!embedRes.ok) return fail(`Erreur Voyage AI: ${embedRes.status}`);
      const embedData = await embedRes.json();
      const queryVec = embedData.data?.[0]?.embedding;
      if (!queryVec) return fail('Echec de l\'embedding.');

      const db = createServiceClient();
      const vecStr = `[${queryVec.join(',')}]`;

      const { data: results, error: searchErr } = await db.rpc('match_topics', {
        query_embedding: vecStr,
        match_threshold: 0.3,
        match_count: maxResults,
      });

      if (searchErr) {
        // Fallback to text search
        const { data: textResults } = await db
          .from('topics')
          .select('id, label, phase, status, niches(name)')
          .ilike('label', `%${escapeLike(query)}%`)
          .in('status', ['active', 'in_production', 'proposed'])
          .limit(maxResults);

        if (!textResults?.length) return ok(`Aucun sujet trouve pour « ${query} ».`);

        const lines = textResults.map((t: Record<string, unknown>) => {
          const niche = (t.niches as unknown as { name: string } | null)?.name ?? '';
          return `- **${t.label}** — ${phaseLabel(t.phase as number)} — ${niche} — ID: \`${t.id}\``;
        });
        return ok(`# Recherche : « ${query} » (${textResults.length} resultats, recherche textuelle)\n\n${lines.join('\n')}`);
      }

      if (!results?.length) return ok(`Aucun sujet trouve pour « ${query} ».`);

      const lines = results.map((r: Record<string, unknown>, i: number) =>
        `${i + 1}. **${r.label}** (similarite ${fmt(r.similarity as number, 2)}) — ${phaseLabel(r.phase as number)} — ID: \`${r.id}\``,
      );

      return ok(`# Recherche semantique : « ${query} » (${results.length} resultats)\n\n${lines.join('\n')}`);
    },
  );

  // ── get_topic_gap ──────────────────────────────────────────────────

  mcp.tool(
    'get_topic_gap',
    'Retourne le MGI decompose d\'un sujet : demande, offre qualifiee, frustration, monetisation, phase, et les frustrations principales avec citations. C\'est la synthese qu\'aucun concurrent n\'offre : l\'ecart entre ce que les spectateurs reclament et ce qui existe.',
    {
      topic_id: z.string().uuid().describe('UUID du sujet'),
    },
    async ({ topic_id }) => {
      const blocked = await guard(token, 'get_topic_gap');
      if (blocked) return fail(blocked);

      const db = createServiceClient();

      const { data: topic } = await db
        .from('topics')
        .select('id, label, phase, status, niches(name, rpm_coefficient)')
        .eq('id', topic_id)
        .single();

      if (!topic) return fail('Sujet introuvable.');

      const niche = topic.niches as unknown as { name: string; rpm_coefficient: number } | null;

      const { data: score } = await db
        .from('topic_scores')
        .select('mgi, demand, frustration, supply_q, monetization, phase, scored_at, feasibility_grade, feasibility_reason')
        .eq('topic_id', topic_id)
        .order('scored_at', { ascending: false })
        .limit(1)
        .single();

      const { data: frustRows } = await db
        .from('comment_labels')
        .select('label, requested_angle, confidence, comments!inner(text, like_count, video_id, videos!inner(topic_id))')
        .eq('comments.videos.topic_id', topic_id)
        .neq('label', 'none')
        .gte('confidence', 0.7)
        .order('comments(like_count)', { ascending: false })
        .limit(10);

      const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString();
      const { data: vids } = await db
        .from('videos')
        .select('title, channels(title)')
        .eq('topic_id', topic_id)
        .eq('is_qualified', true)
        .gte('published_at', sixMonthsAgo)
        .order('published_at', { ascending: false })
        .limit(5);

      const { data: angles } = await db
        .from('angles')
        .select('id, title, hook, status')
        .eq('topic_id', topic_id)
        .order('created_at', { ascending: false })
        .limit(5);

      const sections: string[] = [
        `# ${topic.label}`,
        `Niche : ${niche?.name ?? '?'} (RPM x${niche?.rpm_coefficient ?? '?'})`,
        `Statut : ${topic.status} | Phase : ${phaseLabel(score?.phase ?? topic.phase)}`,
      ];

      if (score) {
        sections.push(
          '',
          '## Decomposition du MGI',
          `- **MGI : ${fmt(score.mgi as number)}** (scores du ${score.scored_at})`,
          `- Demande (D) : ${fmt(score.demand as number, 0)}`,
          `- Frustration (F) : ${fmt((score.frustration as number) * 100, 0)} %`,
          `- Offre qualifiee (Oq) : ${fmt(score.supply_q as number)}`,
          `- Monetisation (P) : x${fmt(score.monetization as number)}`,
        );
        if (score.feasibility_grade) {
          sections.push(
            '',
            '## Faisabilite',
            `- **Note : ${score.feasibility_grade}**`,
            `- ${score.feasibility_reason ?? 'Aucune explication disponible.'}`,
          );
        }
      }

      if (frustRows?.length) {
        sections.push('', `## Frustrations (${frustRows.length})`);
        for (const f of frustRows) {
          const c = (f as Record<string, unknown>).comments as unknown as { text: string; like_count: number; video_id: string };
          const angle = f.requested_angle ? ` → ${f.requested_angle}` : '';
          sections.push(`- [${c.like_count} likes] « ${c.text.slice(0, 150)} »${angle}`);
        }
      }

      if (vids?.length) {
        sections.push('', `## Concurrents (${vids.length})`);
        for (const v of vids) {
          const ch = (v as Record<string, unknown>).channels as unknown as { title: string };
          sections.push(`- ${v.title} (${ch?.title ?? '?'})`);
        }
      }

      if (angles?.length) {
        sections.push('', `## Angles generes (${angles.length})`);
        for (const a of angles) {
          sections.push(`- **${a.title}** [${a.status}] — ${a.hook}`, `  ID: \`${a.id}\``);
        }
      }

      return ok(sections.join('\n'));
    },
  );

  // ── get_topic_phase ────────────────────────────────────────────────

  mcp.tool(
    'get_topic_phase',
    'Retourne la phase actuelle d\'un sujet avec l\'historique des 30 derniers jours de scores. Utilise pour comprendre la trajectoire d\'un sujet.',
    {
      topic_id: z.string().uuid().describe('UUID du sujet'),
    },
    async ({ topic_id }) => {
      const blocked = await guard(token, 'get_topic_phase');
      if (blocked) return fail(blocked);

      const db = createServiceClient();

      const { data: topic } = await db
        .from('topics')
        .select('id, label, phase, status, niches(name)')
        .eq('id', topic_id)
        .single();

      if (!topic) return fail('Sujet introuvable.');

      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data: history } = await db
        .from('topic_scores')
        .select('scored_at, mgi, phase')
        .eq('topic_id', topic_id)
        .gte('scored_at', thirtyDaysAgo)
        .order('scored_at', { ascending: true });

      const niche = (topic.niches as unknown as { name: string } | null)?.name ?? '?';

      const sections = [
        `# Phase de « ${topic.label} »`,
        `Niche : ${niche} | Statut : ${topic.status}`,
        `Phase actuelle : **${phaseLabel(topic.phase as number)}**`,
      ];

      if (history?.length) {
        const phase2Entry = history.find((h: Record<string, unknown>) => h.phase === 2);
        if (phase2Entry) {
          sections.push(`Fenetre ouverte le : ${phase2Entry.scored_at}`);
        }

        sections.push('', '## Historique (30 jours)', '| Date | MGI | Phase |', '|------|-----|-------|');
        for (const h of history as { scored_at: string; mgi: number; phase: number }[]) {
          sections.push(`| ${h.scored_at} | ${fmt(h.mgi)} | ${phaseLabel(h.phase)} |`);
        }
      } else {
        sections.push('', 'Aucun historique de score disponible.');
      }

      return ok(sections.join('\n'));
    },
  );

  // ── list_frustrations ──────────────────────────────────────────────

  mcp.tool(
    'list_frustrations',
    'Liste les frustrations exprimees dans les commentaires YouTube pour un sujet, avec la citation exacte, le nombre de likes et le lien vers le commentaire. C\'est le coeur de la proposition TubLyTI : les angles de contenu viennent des douleurs reelles.',
    {
      topic_id: z.string().uuid().describe('UUID du sujet'),
      limit: z.number().optional().describe('Nombre max (defaut 20, max 50)'),
    },
    async ({ topic_id, limit }) => {
      const blocked = await guard(token, 'list_frustrations');
      if (blocked) return fail(blocked);

      const maxResults = Math.min(limit ?? 20, 50);
      const db = createServiceClient();

      const { data: topic } = await db
        .from('topics')
        .select('id, label')
        .eq('id', topic_id)
        .single();

      if (!topic) return fail('Sujet introuvable.');

      const { data: frustRows } = await db
        .from('comment_labels')
        .select('label, requested_angle, confidence, comments!inner(id, text, like_count, video_id, videos!inner(topic_id))')
        .eq('comments.videos.topic_id', topic_id)
        .neq('label', 'none')
        .gte('confidence', 0.7)
        .order('comments(like_count)', { ascending: false })
        .limit(maxResults);

      if (!frustRows?.length) return ok(`Aucune frustration detectee pour « ${topic.label} ».`);

      const lines = frustRows.map((f: Record<string, unknown>) => {
        const c = f.comments as unknown as { id: string; text: string; like_count: number; video_id: string };
        const angle = (f as Record<string, unknown>).requested_angle ? ` → ${(f as Record<string, unknown>).requested_angle}` : '';
        const ytLink = `https://www.youtube.com/watch?v=${c.video_id}&lc=${c.id}`;
        return `- [${c.like_count} likes] « ${c.text.slice(0, 200)} »${angle}\n  Type : ${f.label} | [Voir sur YouTube](${ytLink})`;
      });

      return ok(`# Frustrations — ${topic.label} (${frustRows.length})\n\n${lines.join('\n\n')}`);
    },
  );

  // ── get_niche_dossier ──────────────────────────────────────────────

  mcp.tool(
    'get_niche_dossier',
    'Genere un dossier complet d\'une niche en Markdown : top 10 sujets avec MGI decompose, chaines suivies, formules de titres, fourchette RPM, frustrations et concurrents du sujet n°1. Exportable tel quel.',
    {
      niche: z.string().describe('Nom, categorie ou chaine liee de la niche'),
    },
    async ({ niche }) => {
      const blocked = await guard(token, 'get_niche_dossier');
      if (blocked) return fail(blocked);

      const db = createServiceClient();
      const resolved = await resolveNicheOrFail(db, niche);
      if (!resolved.niche) {
        return fail(`Niche « ${niche} » introuvable. Disponibles : ${resolved.available.join(', ')}.`);
      }
      const nicheRow = resolved.niche;
      const scoredAt = await getLatestScoreDate(db);

      // Niche RPM data
      const { data: nicheDetail } = await db
        .from('niches')
        .select('rpm_coefficient, rpm_low, rpm_high, rpm_source')
        .eq('id', nicheRow.id)
        .single();

      const { data: scores } = await db
        .from('topic_scores')
        .select('mgi, demand, frustration, supply_q, monetization, phase, feasibility_grade, topic_id, topics!inner(id, label, status, niche_id)')
        .eq('topics.niche_id', nicheRow.id)
        .eq('scored_at', scoredAt)
        .order('mgi', { ascending: false })
        .limit(10);

      const { data: channels } = await db
        .from('channels')
        .select('id, title, subscriber_count')
        .eq('niche_id', nicheRow.id)
        .order('subscriber_count', { ascending: false });

      const { data: prodTopics } = await db
        .from('topics')
        .select('id, label')
        .eq('niche_id', nicheRow.id)
        .eq('status', 'in_production');

      // Title patterns
      const { data: patterns } = await db
        .from('title_patterns')
        .select('formula, description, examples, frequency, emotional_triggers')
        .eq('niche_id', nicheRow.id)
        .order('frequency', { ascending: false })
        .limit(10);

      const sections = [
        `# Dossier — ${nicheRow.name}`,
        `Categorie : ${nicheRow.category ?? '—'} | Chaine : ${nicheRow.owner_channel ?? '—'}`,
        `Scores du ${scoredAt}`,
      ];

      // RPM
      if (nicheDetail) {
        const rpmLow = nicheDetail.rpm_low as number | null;
        const rpmHigh = nicheDetail.rpm_high as number | null;
        const rpmSrc = nicheDetail.rpm_source as string | null;
        const rpmCoeff = Number(nicheDetail.rpm_coefficient);
        if (rpmLow && rpmHigh) {
          sections.push(`RPM : **${rpmLow}–${rpmHigh} $** (${rpmSrc ?? `coeff. x${rpmCoeff}`})`);
        } else {
          sections.push(`RPM : coefficient x${rpmCoeff}`);
        }
      }

      sections.push('', '## Top 10 sujets');

      if (scores?.length) {
        sections.push('| # | Sujet | MGI | Phase | Fais. | D | F | Oq | P |', '|---|-------|-----|-------|-------|---|---|----|----|');
        scores.forEach((s: Record<string, unknown>, i: number) => {
          const topic = s.topics as unknown as { label: string };
          const fGrade = (s.feasibility_grade as string) ?? '—';
          sections.push(
            `| ${i + 1} | ${topic.label} | ${fmt(s.mgi as number)} | ${phaseLabel(s.phase as number)} | ${fGrade} | ${fmt(s.demand as number, 0)} | ${fmt((s.frustration as number) * 100, 0)}% | ${fmt(s.supply_q as number)} | x${fmt(s.monetization as number)} |`,
          );
        });
      } else {
        sections.push('Aucun sujet score.');
      }

      sections.push('', '## Chaines suivies');
      if (channels?.length) {
        for (const ch of channels as { title: string; subscriber_count: number }[]) {
          sections.push(`- ${ch.title ?? '?'} (${ch.subscriber_count?.toLocaleString('fr-FR') ?? '?'} abonnes)`);
        }
      } else {
        sections.push('Aucune chaine suivie.');
      }

      // Title patterns
      if (patterns?.length) {
        sections.push('', `## Formules de titres (${patterns.length})`);
        for (const p of patterns as { formula: string; description: string; examples: string[]; frequency: number; emotional_triggers: string[] }[]) {
          sections.push(`- **${p.formula}** (${p.frequency}x) : ${p.description}`);
          if (p.emotional_triggers?.length) {
            sections.push(`  Declencheurs : ${p.emotional_triggers.join(', ')}`);
          }
          if (p.examples?.length) {
            sections.push(`  Exemples : ${p.examples.slice(0, 2).join(' | ')}`);
          }
        }
      }

      // Top frustrations from #1 topic
      if (scores?.length) {
        const topTopic = (scores[0].topics as unknown as { id: string; label: string });
        const { data: frustRows } = await db
          .from('comment_labels')
          .select('label, requested_angle, comments!inner(text, like_count, video_id, videos!inner(topic_id))')
          .eq('comments.videos.topic_id', topTopic.id)
          .neq('label', 'none')
          .gte('confidence', 0.7)
          .order('comments(like_count)', { ascending: false })
          .limit(10);

        if (frustRows?.length) {
          sections.push('', `## Frustrations — ${topTopic.label} (sujet n°1)`);
          for (const f of frustRows) {
            const c = (f as Record<string, unknown>).comments as unknown as { text: string; like_count: number };
            sections.push(`- [${c.like_count} likes] « ${c.text.slice(0, 150)} »`);
          }
        }

        // Top 5 competitors for #1 topic
        const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString();
        const { data: vids } = await db
          .from('videos')
          .select('title, channels(title, subscriber_count)')
          .eq('topic_id', topTopic.id)
          .eq('is_qualified', true)
          .gte('published_at', sixMonthsAgo)
          .order('published_at', { ascending: false })
          .limit(5);

        if (vids?.length) {
          sections.push('', `## Concurrents — ${topTopic.label}`);
          for (const v of vids) {
            const ch = (v as Record<string, unknown>).channels as unknown as { title: string; subscriber_count: number | null };
            const subs = ch?.subscriber_count ? ` (${ch.subscriber_count.toLocaleString('fr-FR')} ab.)` : '';
            sections.push(`- ${v.title} — ${ch?.title ?? '?'}${subs}`);
          }
        }

        // Angles for #1 topic
        const { data: angles } = await db
          .from('angles')
          .select('title, hook, rationale, formula, frustration_resolved')
          .eq('topic_id', topTopic.id)
          .order('created_at', { ascending: false })
          .limit(5);

        if (angles?.length) {
          sections.push('', `## Angles — ${topTopic.label}`);
          for (const [i, a] of (angles as { title: string; hook: string; rationale: string; formula: string | null; frustration_resolved: string | null }[]).entries()) {
            sections.push(`${i + 1}. **${a.title}** — ${a.hook}`);
            sections.push(`   ${a.rationale}${a.formula ? ` | Formule : ${a.formula}` : ''}${a.frustration_resolved ? ` | Frustration : ${a.frustration_resolved}` : ''}`);
          }
        }
      }

      if (prodTopics?.length) {
        sections.push('', '## En production');
        for (const t of prodTopics as { label: string }[]) {
          sections.push(`- ${t.label}`);
        }
      }

      sections.push('', `---\n*Dossier genere par TubLyTI — ${new Date().toISOString().slice(0, 10)}*`);

      return ok(sections.join('\n'));
    },
  );

  // ── channel_outliers ───────────────────────────────────────────────

  mcp.tool(
    'channel_outliers',
    'Liste les videos outliers d\'une chaine : videos dont les vues depassent significativement la mediane de la chaine. Le score d\'outlier est date.',
    {
      channel_id: z.string().describe('ID YouTube de la chaine'),
      min_ratio: z.number().optional().describe('Ratio minimum vues/mediane (defaut 2.0)'),
      limit: z.number().optional().describe('Nombre max (defaut 10)'),
    },
    async ({ channel_id, min_ratio, limit }) => {
      const blocked = await guard(token, 'channel_outliers');
      if (blocked) return fail(blocked);

      const db = createServiceClient();
      const minR = min_ratio ?? 2.0;
      const maxResults = Math.min(limit ?? 10, 30);

      const { data: channel } = await db
        .from('channels')
        .select('id, title, subscriber_count')
        .eq('id', channel_id)
        .single();

      if (!channel) return fail('Chaine introuvable.');

      const { data: videos } = await db
        .from('videos')
        .select('id, title, published_at, topic_id')
        .eq('channel_id', channel_id)
        .order('published_at', { ascending: false })
        .limit(50);

      if (!videos?.length) return ok(`Aucune video indexee pour ${channel.title}.`);

      const videoIds = videos.map((v: { id: string }) => v.id);
      const { data: snapshots } = await db
        .from('video_snapshots')
        .select('video_id, views')
        .in('video_id', videoIds)
        .order('captured_at', { ascending: false });

      const viewsMap: Record<string, number> = {};
      const seen = new Set<string>();
      for (const s of snapshots ?? []) {
        if (!seen.has(s.video_id)) {
          seen.add(s.video_id);
          viewsMap[s.video_id] = Number(s.views);
        }
      }

      const allViews = Object.values(viewsMap).filter((v) => v > 0).sort((a, b) => a - b);
      if (allViews.length < 3) return ok('Pas assez de videos avec des donnees pour calculer les outliers.');

      const median = allViews[Math.floor(allViews.length / 2)];

      const outliers = videos
        .filter((v: { id: string }) => {
          const views = viewsMap[v.id];
          return views && views / median >= minR;
        })
        .slice(0, maxResults)
        .map((v: { id: string; title: string; published_at: string }) => {
          const views = viewsMap[v.id];
          const ratio = views / median;
          return { ...v, views, ratio };
        });

      if (outliers.length === 0) return ok(`Aucun outlier (ratio >= ${minR}x) pour ${channel.title}.`);

      const sections = [
        `# Outliers — ${channel.title}`,
        `Mediane des vues : ${median.toLocaleString('fr-FR')} | Seuil : ${minR}x`,
        '',
      ];

      for (const o of outliers) {
        sections.push(
          `- **${o.title}** — ${o.views.toLocaleString('fr-FR')} vues (${o.ratio.toFixed(1)}x mediane)`,
          `  Publiee le ${new Date(o.published_at).toLocaleDateString('fr-FR')} | https://youtube.com/watch?v=${o.id}`,
        );
      }

      return ok(sections.join('\n'));
    },
  );

  // ── similar_channels ───────────────────────────────────────────────

  mcp.tool(
    'similar_channels',
    'Trouve les chaines les plus similaires par embedding (moyenne des 20 derniers titres de videos). Retourne les 5 plus proches avec leur score de similarite. Si aucun embedding n\'est disponible, retourne les chaines de la meme niche.',
    {
      channel_id: z.string().describe('ID YouTube de la chaine de reference'),
      limit: z.number().optional().describe('Nombre max (defaut 5, max 20)'),
    },
    async ({ channel_id, limit }) => {
      const blocked = await guard(token, 'similar_channels');
      if (blocked) return fail(blocked);

      const db = createServiceClient();
      const maxResults = Math.min(limit ?? 5, 20);

      const { data: channel } = await db
        .from('channels')
        .select('id, title, niche_id, subscriber_count, embedding')
        .eq('id', channel_id)
        .single();

      if (!channel) return fail('Chaine introuvable.');

      // Try embedding-based similarity first
      if (channel.embedding) {
        const { data: results } = await db.rpc('match_channels', {
          query_embedding: channel.embedding,
          match_threshold: 0.3,
          match_count: maxResults,
          exclude_id: channel_id,
        });

        if (results?.length) {
          const lines = results.map(
            (r: Record<string, unknown>, i: number) =>
              `${i + 1}. **${r.title}** — ${Number(r.subscriber_count ?? 0).toLocaleString('fr-FR')} abonnes — similarite ${Number(r.similarity).toFixed(2)}`,
          );
          return ok(`# Chaines similaires a ${channel.title} (par embedding)\n\n${lines.join('\n')}`);
        }
      }

      // Fallback to niche-based
      const { data: siblings } = await db
        .from('channels')
        .select('id, title, subscriber_count')
        .eq('niche_id', channel.niche_id)
        .neq('id', channel_id)
        .order('subscriber_count', { ascending: false })
        .limit(maxResults);

      if (!siblings?.length) return ok('Aucune chaine similaire trouvee.');

      const lines = siblings.map(
        (ch: { title: string; subscriber_count: number; id: string }) =>
          `- **${ch.title ?? ch.id}** — ${ch.subscriber_count?.toLocaleString('fr-FR') ?? '?'} abonnes`,
      );

      return ok(`# Chaines similaires a ${channel.title} (meme niche, ${siblings.length})\n\n${lines.join('\n')}`);
    },
  );

  // ────────────────────────────────────────────────────────────────────
  //  WRITE TOOLS
  // ────────────────────────────────────────────────────────────────────

  // ── generate_angles ────────────────────────────────────────────────

  mcp.tool(
    'generate_angles',
    'Genere 5 angles de contenu pour un sujet a partir des frustrations reelles des spectateurs. Cout estime : ~0,02 $ par appel (Claude Sonnet). Le budget IA quotidien est plafonne. Necessite un jeton lecture/ecriture.',
    {
      topic_id: z.string().uuid().describe('UUID du sujet'),
    },
    async ({ topic_id }) => {
      const blocked = await guard(token, 'generate_angles', { write: true });
      if (blocked) return fail(blocked);

      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      const res = await fetch(`${baseUrl}/api/topics/${topic_id}/angles`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        return fail(data.error ?? 'Erreur lors de la generation des angles.');
      }

      const db = createServiceClient();
      const { data: angles } = await db
        .from('angles')
        .select('id, title, hook, rationale')
        .eq('topic_id', topic_id)
        .order('created_at', { ascending: false })
        .limit(5);

      const lines = (angles ?? []).map(
        (a: { id: string; title: string; hook: string; rationale: string }, i: number) =>
          `${i + 1}. **${a.title}**\n   Hook : ${a.hook}\n   Raison : ${a.rationale}\n   ID : \`${a.id}\``,
      );

      return ok(
        `# 5 angles generes (cout : ${data.costUSD ? `$${data.costUSD.toFixed(3)}` : '~$0.02'})\n\n${lines.join('\n\n')}`,
      );
    },
  );

  // ── save_to_collection ─────────────────────────────────────────────

  mcp.tool(
    'save_to_collection',
    'Sauvegarde un sujet, une video, une chaine ou un angle dans les favoris (collection par defaut). Necessite un jeton lecture/ecriture.',
    {
      item_type: z.enum(['topic', 'video', 'channel', 'angle']).describe('Type d\'element'),
      ref_id: z.string().describe('ID de l\'element a sauvegarder'),
      note: z.string().optional().describe('Note optionnelle'),
    },
    async ({ item_type, ref_id, note }) => {
      const blocked = await guard(token, 'save_to_collection', { write: true });
      if (blocked) return fail(blocked);

      const db = createServiceClient();

      const { data: defaultCol } = await db
        .from('collections')
        .select('id')
        .eq('is_default', true)
        .single();

      if (!defaultCol) return fail('Collection par defaut introuvable. Cree-en une dans Reglages.');

      const { error: upsertErr } = await db
        .from('collection_items')
        .upsert(
          { collection_id: defaultCol.id, item_type, ref_id, note: note ?? null },
          { onConflict: 'collection_id,item_type,ref_id' },
        );

      if (upsertErr) return fail(`Erreur : ${upsertErr.message}`);

      return ok(`Element sauvegarde dans les favoris (${item_type} \`${ref_id}\`).`);
    },
  );

  // ── create_pipeline_card ───────────────────────────────────────────

  mcp.tool(
    'create_pipeline_card',
    'Cree une carte dans le pipeline de production en selectionnant un angle pour un sujet et en le passant en production. Necessite un jeton lecture/ecriture.',
    {
      topic_id: z.string().uuid().describe('UUID du sujet'),
      angle_id: z.string().uuid().describe('UUID de l\'angle a mettre en production'),
    },
    async ({ topic_id, angle_id }) => {
      const blocked = await guard(token, 'create_pipeline_card', { write: true });
      if (blocked) return fail(blocked);

      const db = createServiceClient();

      const { data: topic } = await db
        .from('topics')
        .select('id, label, status')
        .eq('id', topic_id)
        .single();

      if (!topic) return fail('Sujet introuvable.');

      const { data: angle } = await db
        .from('angles')
        .select('id, title, topic_id')
        .eq('id', angle_id)
        .eq('topic_id', topic_id)
        .single();

      if (!angle) return fail('Angle introuvable ou ne correspond pas au sujet.');

      await db.from('topics').update({ status: 'in_production' }).eq('id', topic_id);
      await db.from('angles').update({ status: 'in_production' }).eq('id', angle_id);

      return ok(`« ${topic.label} » passe en production avec l'angle « ${angle.title} ».`);
    },
  );

  // ── mark_published ─────────────────────────────────────────────────

  mcp.tool(
    'mark_published',
    'Marque un angle comme publie en associant l\'ID de la video YouTube. Valide l\'existence de la video (1 unite de quota YouTube). Necessite un jeton lecture/ecriture.',
    {
      angle_id: z.string().uuid().describe('UUID de l\'angle a publier'),
      video_id: z.string().describe('ID de la video YouTube publiee (ex: dQw4w9WgXcQ)'),
    },
    async ({ angle_id, video_id }) => {
      const blocked = await guard(token, 'mark_published', { write: true });
      if (blocked) return fail(blocked);

      if (!video_id?.trim()) return fail('L\'identifiant de la video YouTube est requis.');

      const db = createServiceClient();

      const { data: angle } = await db
        .from('angles')
        .select('id, title, topic_id')
        .eq('id', angle_id)
        .single();

      if (!angle) return fail('Angle introuvable.');

      const ytKey = process.env.YOUTUBE_API_KEY;
      if (ytKey) {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=id&id=${encodeURIComponent(video_id.trim())}&key=${ytKey}`,
        );
        const data = await res.json();
        if (!data.items?.length) return fail('Video YouTube introuvable. Verifie l\'identifiant.');
      }

      await db.from('angles').update({ status: 'published', video_id: video_id.trim() }).eq('id', angle_id);
      await db.from('topics').update({ status: 'published' }).eq('id', angle.topic_id);

      return ok(`Angle « ${angle.title} » marque comme publie (video ${video_id.trim()}).`);
    },
  );

  // ── add_candidate_channel ──────────────────────────────────────────

  mcp.tool(
    'add_candidate_channel',
    'Ajoute une chaine YouTube a suivre dans une niche. Recupere les infos de base via l\'API YouTube (1 unite de quota). Necessite un jeton lecture/ecriture.',
    {
      channel_id: z.string().describe('ID YouTube de la chaine (ex: UCxxxxxx)'),
      niche: z.string().describe('Nom de la niche a laquelle rattacher la chaine'),
    },
    async ({ channel_id, niche }) => {
      const blocked = await guard(token, 'add_candidate_channel', { write: true });
      if (blocked) return fail(blocked);

      const db = createServiceClient();

      const { data: existing } = await db
        .from('channels')
        .select('id, title')
        .eq('id', channel_id)
        .single();

      if (existing) return fail(`La chaine « ${existing.title ?? channel_id} » est deja suivie.`);

      const resolved = await resolveNicheOrFail(db, niche);
      if (!resolved.niche) {
        return fail(`Niche « ${niche} » introuvable. Disponibles : ${resolved.available.join(', ')}.`);
      }

      const ytKey = process.env.YOUTUBE_API_KEY;
      let title = channel_id;
      let subscriberCount: number | null = null;
      let uploadsPlaylistId: string | null = null;

      if (ytKey) {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(channel_id)}&key=${ytKey}`,
        );
        const data = await res.json();
        const item = data.items?.[0];
        if (!item) return fail('Chaine YouTube introuvable. Verifie l\'identifiant.');

        title = item.snippet?.title ?? channel_id;
        subscriberCount = Number(item.statistics?.subscriberCount) || null;
        uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads ?? null;
      }

      const { error: insertErr } = await db.from('channels').insert({
        id: channel_id,
        niche_id: resolved.niche.id,
        title,
        subscriber_count: subscriberCount,
        uploads_playlist_id: uploadsPlaylistId,
      });

      if (insertErr) return fail(`Erreur : ${insertErr.message}`);

      return ok(`Chaine « ${title} » ajoutee a la niche « ${resolved.niche.name} ».`);
    },
  );

  // ────────────────────────────────────────────────────────────────────
  //  RESOURCE
  // ────────────────────────────────────────────────────────────────────

  mcp.resource(
    'brief/today',
    'tublyti://brief/today',
    async () => {
      const db = createServiceClient();
      const scoredAt = await getLatestScoreDate(db);

      const { data: allScores } = await db
        .from('topic_scores')
        .select('mgi, phase, topic_id, topics!inner(id, label, niche_id, niches(name))')
        .eq('scored_at', scoredAt)
        .eq('phase', 2)
        .order('mgi', { ascending: false })
        .limit(15);

      if (!allScores?.length) {
        return { contents: [{ uri: 'tublyti://brief/today', text: 'Aucun sujet en fenetre ideale aujourd\'hui.', mimeType: 'text/plain' }] };
      }

      const lines = allScores.map((s: Record<string, unknown>, i: number) => {
        const topic = s.topics as unknown as { id: string; label: string; niches: { name: string } | null };
        return `${i + 1}. **${topic.label}** — MGI ${fmt(s.mgi as number)} — ${topic.niches?.name ?? '?'} — ID: \`${topic.id}\``;
      });

      const text = `# Brief du jour — ${scoredAt}\n\nSujets en fenetre ideale (phase 2), tries par MGI :\n\n${lines.join('\n')}`;

      return { contents: [{ uri: 'tublyti://brief/today', text, mimeType: 'text/markdown' }] };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  //  PROMPT
  // ────────────────────────────────────────────────────────────────────

  mcp.prompt(
    'plan_my_week',
    'Propose 3 sujets par chaine avec justification pour planifier la semaine de production.',
    async () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Tu es un assistant specialise dans la strategie de contenu YouTube.',
              '',
              'Appelle l\'outil `list_today` pour obtenir les meilleures opportunites du jour.',
              'Puis, pour chaque chaine, recommande exactement 3 sujets en justifiant chaque choix :',
              '- Pourquoi ce sujet maintenant (phase, tendance)',
              '- Quelle frustration des spectateurs il comble',
              '- Quel angle serait le plus efficace',
              '',
              'Reponds en francais, de facon concise et actionnable.',
              'Termine par un plan de production sur 7 jours (1 video par jour ouvre).',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return mcp;
}
