import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveNiche } from '@/lib/niches/resolve';
import { getLatestScoreDate } from '@/lib/scoring/latest-score-date';
import { checkRateLimit } from './rate-limit';
import { canWrite, canSeeNiche, type McpTokenInfo } from './auth';
import { listScopeNiches } from '@/lib/scope';
import { escapeLike } from '@/lib/utils';
import { getPublicStats } from '@/lib/youtube/public-stats';
import { getVideoReach } from '@/lib/youtube/reporting';
import { getChannelAnalytics, getVideoRetention, getVideoTotals, PERIODS, type Period } from '@/lib/youtube/analytics';
import { analyzeVideo, parseVideoId, retentionContextFrom, type RetentionContext } from '@/lib/video/analyze';
import { linkSaturation, topicSaturation } from '@/lib/saturation';
import { compareKeywords } from '@/lib/keywords';
import { getLatestSnapshots } from '@/lib/youtube/latest-snapshots';
import { isMissingFunction, markRpcMissing, readAllPages, rpcKnownMissing } from '@/lib/supabase/rpc-fallback';

// ── Constants ──────────────────────────────────────────────────────────

const PHASE_LABELS: Record<number, string> = {
  0: 'A surveiller',
  1: 'Ca monte',
  2: "C'est le moment",
  3: 'Trop tard',
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

const OUT_OF_SCOPE = 'Ce contenu ne fait pas partie de tes thematiques. Ajoute la thematique dans Reglages > Mes chaines.';

async function guard(
  token: McpTokenInfo,
  toolName: string,
  opts?: { write?: boolean; admin?: boolean; topicId?: string; channelId?: string },
): Promise<string | null> {
  if (opts?.admin && !token.isAdmin) {
    return 'Outil reserve a l\'equipe TubLyTI.';
  }
  if (opts?.topicId && token.nicheIds !== null) {
    const { data } = await createServiceClient().from('topics').select('niche_id').eq('id', opts.topicId).maybeSingle();
    if (!data) return 'Sujet introuvable.';
    if (!canSeeNiche(token, data.niche_id as string)) return OUT_OF_SCOPE;
  }
  if (opts?.channelId && token.nicheIds !== null) {
    const { data } = await createServiceClient().from('channels').select('niche_id').eq('id', opts.channelId).maybeSingle();
    if (!data) return 'Chaine introuvable.';
    if (!canSeeNiche(token, data.niche_id as string)) return OUT_OF_SCOPE;
  }
  if (opts?.write && !canWrite(token)) {
    return 'Acces refuse : ce jeton est en lecture seule. Cree un jeton lecture/ecriture dans Reglages > Connexion a Claude.';
  }
  const rl = await checkRateLimit(token.id, toolName);
  if (!rl.allowed) {
    return `Plafond quotidien atteint pour ${toolName} (${rl.limit}/jour). Les compteurs sont reinitialises a minuit UTC.`;
  }
  return null;
}

async function resolveNicheOrFail(db: ReturnType<typeof createServiceClient>, query: string, token: McpTokenInfo) {
  const { data: allNiches } = await db
    .from('niches')
    .select('id, name, category, owner_channel');
  // Un jeton client ne voit que ses thematiques.
  const visible = (allNiches ?? []).filter((n: { id: string }) => canSeeNiche(token, n.id));
  return resolveNiche(query, visible);
}

/** Restreint une requete aux thematiques du jeton (aucun filtre pour un administrateur). */
function inScope<Q>(q: Q, column: string, token: McpTokenInfo): Q {
  if (token.nicheIds === null) return q;
  const ids = token.nicheIds.length ? token.nicheIds : ['00000000-0000-0000-0000-000000000000'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).in(column, ids);
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
      const { data: niches } = await inScope(
        db.from('niches').select('id, name, category, rpm_coefficient, owner_channel, status').eq('status', 'active'),
        'id',
        token,
      ).order('name');

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
    'Retourne le flux « Aujourd\'hui » : par chaine, les 3 meilleures opportunites (phase 2 d\'abord, puis MGI), avec la frustration principale. Utilise cet outil pour repondre a « Quels sujets choisir cette semaine ? ».',
    {},
    async () => {
      const blocked = await guard(token, 'list_today');
      if (blocked) return fail(blocked);

      const db = createServiceClient();
      const scoredAt = await getLatestScoreDate(db);

      // Client : ses propres chaines. Administrateur : les chaines du catalogue.
      const channels = token.userId && !token.isAdmin
        ? (await listScopeNiches(db, token.userId)).map((n) => ({ id: n.id, title: n.label, niche_id: n.id, niches: { id: n.id, name: n.nicheName } }))
        : (await readAllPages<Record<string, unknown>>((from, to) => db.from('channels').select('id, title, niche_id, niches(id, name)').order('title').order('id').range(from, to))).data;

      if (!channels?.length) return ok('Aucune chaine configuree. Ajoute ta chaine dans Reglages > Mes chaines.');

      // Paginated: all topic scores of the day exceed the 1,000-row cap on a large catalogue.
      const { data: allScores } = await readAllPages<Record<string, unknown>>((from, to) =>
        inScope(
          db
            .from('topic_scores')
            .select('mgi, demand, frustration, supply_q, phase, topic_id, topics!inner(id, label, status, niche_id)')
            .eq('scored_at', scoredAt)
            .in('topics.status', ['active', 'in_production']),
          'topics.niche_id',
          token,
        )
          .order('mgi', { ascending: false })
          .order('topic_id', { ascending: true })
          .range(from, to),
      );

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

      const resolved = await resolveNicheOrFail(db, niche, token);
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

      // Text search when there is no embedding key, or when match_topics (migration 00031) is known to be missing:
      // no paid Voyage call for a search that cannot run.
      if (!voyageKey || rpcKnownMissing('match_topics')) {
        // Fallback to text search
        const db = createServiceClient();
        const { data: textResults } = await inScope(
          db
            .from('topics')
            .select('id, label, phase, status, niches(name)')
            .ilike('label', `%${escapeLike(query)}%`)
            .in('status', token.isAdmin ? ['active', 'in_production', 'proposed'] : ['active', 'in_production']),
          'niche_id',
          token,
        ).limit(maxResults);

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
        p_niche_ids: token.nicheIds,
      });

      if (searchErr) {
        if (isMissingFunction(searchErr)) markRpcMissing('match_topics');
        // Fallback to text search
        const { data: textResults } = await inScope(
          db
            .from('topics')
            .select('id, label, phase, status, niches(name)')
            .ilike('label', `%${escapeLike(query)}%`)
            .in('status', token.isAdmin ? ['active', 'in_production', 'proposed'] : ['active', 'in_production']),
          'niche_id',
          token,
        ).limit(maxResults);

        if (!textResults?.length) return ok(`Aucun sujet trouve pour « ${query} ».`);

        const lines = textResults.map((t: Record<string, unknown>) => {
          const niche = (t.niches as unknown as { name: string } | null)?.name ?? '';
          return `- **${t.label}** — ${phaseLabel(t.phase as number)} — ${niche} — ID: \`${t.id}\``;
        });
        return ok(`# Recherche : « ${query} » (${textResults.length} resultats, recherche textuelle)\n\n${lines.join('\n')}`);
      }

      let visible = (results ?? []) as Record<string, unknown>[];
      if (token.nicheIds !== null && visible.length) {
        // Recherche semantique : ne garder que les sujets des thematiques du client.
        const { data: owned } = await inScope(
          db.from('topics').select('id').in('id', visible.map((r) => r.id as string)).in('status', ['active', 'in_production']),
          'niche_id',
          token,
        );
        const ok2 = new Set(((owned ?? []) as { id: string }[]).map((o) => o.id));
        visible = visible.filter((r) => ok2.has(r.id as string));
      }
      if (!visible.length) return ok(`Aucun sujet trouve pour « ${query} ».`);

      const lines = visible.map((r: Record<string, unknown>, i: number) =>
        `${i + 1}. **${r.label}** (similarite ${fmt(r.similarity as number, 2)}) — ${phaseLabel(r.phase as number)} — ID: \`${r.id}\``,
      );

      return ok(`# Recherche semantique : « ${query} » (${visible.length} resultats)\n\n${lines.join('\n')}`);
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
      const blocked = await guard(token, 'get_topic_gap', { topicId: topic_id });
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
      const blocked = await guard(token, 'get_topic_phase', { topicId: topic_id });
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
      const blocked = await guard(token, 'list_frustrations', { topicId: topic_id });
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
      const resolved = await resolveNicheOrFail(db, niche, token);
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
      const blocked = await guard(token, 'channel_outliers', { channelId: channel_id });
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
      const viewsMap: Record<string, number> = {};
      for (const [vid, s] of await getLatestSnapshots(db, videoIds)) viewsMap[vid] = Number(s.views);

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
      const blocked = await guard(token, 'similar_channels', { channelId: channel_id });
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
      const blocked = await guard(token, 'generate_angles', { write: true, admin: true });
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

      // Favoris du proprietaire du jeton (crees au premier usage).
      let colQ = db.from('collections').select('id').eq('is_default', true);
      if (token.userId) colQ = colQ.eq('user_id', token.userId);
      let { data: defaultCol } = await colQ.limit(1).maybeSingle();
      if (!defaultCol && token.userId) {
        ({ data: defaultCol } = await db.from('collections').insert({ name: 'Favoris', is_default: true, user_id: token.userId }).select('id').single());
      }

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
      const blocked = await guard(token, 'create_pipeline_card', { write: true, topicId: topic_id });
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

      if (token.userId) {
        // Compte client : nouvelle video dans SES « Mes videos » ; l'angle propose (commun) n'est pas modifie.
        const { data: full } = await db.from('angles').select('title, hook').eq('id', angle_id).single();
        const { error: insErr } = await db.from('angles').insert({
          topic_id,
          title: (full?.title as string) ?? angle.title,
          hook: (full?.hook as string | null) ?? null,
          status: 'in_production',
          user_id: token.userId,
        });
        if (insErr) return fail(`Erreur : ${insErr.message}`);
      } else {
        await db.from('topics').update({ status: 'in_production' }).eq('id', topic_id);
        await db.from('angles').update({ status: 'in_production' }).eq('id', angle_id);
      }

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

      let angleQ = db.from('angles').select('id, title, topic_id').eq('id', angle_id);
      if (token.userId) angleQ = angleQ.eq('user_id', token.userId);
      const { data: angle } = await angleQ.maybeSingle();

      if (!angle) return fail('Video introuvable dans tes « Mes videos ».');

      const ytKey = process.env.YOUTUBE_API_KEY;
      if (ytKey) {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=id&id=${encodeURIComponent(video_id.trim())}&key=${ytKey}`,
        );
        const data = await res.json();
        if (!data.items?.length) return fail('Video YouTube introuvable. Verifie l\'identifiant.');
      }

      await db.from('angles').update({ status: 'published', video_id: video_id.trim() }).eq('id', angle_id);
      if (!token.userId) await db.from('topics').update({ status: 'published' }).eq('id', angle.topic_id);

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
      const blocked = await guard(token, 'add_candidate_channel', { write: true, admin: true });
      if (blocked) return fail(blocked);

      const db = createServiceClient();

      const { data: existing } = await db
        .from('channels')
        .select('id, title')
        .eq('id', channel_id)
        .single();

      if (existing) return fail(`La chaine « ${existing.title ?? channel_id} » est deja suivie.`);

      const resolved = await resolveNicheOrFail(db, niche, token);
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

      const { data: allScores } = await inScope(
        db
          .from('topic_scores')
          .select('mgi, phase, topic_id, topics!inner(id, label, niche_id, niches(name))')
          .eq('scored_at', scoredAt)
          .eq('phase', 2),
        'topics.niche_id',
        token,
      )
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
  //  MA CHAÎNE (lecture seule, chaînes vérifiées du propriétaire du jeton)
  // ────────────────────────────────────────────────────────────────────

  type MyChannel = { id: string; title: string; handle: string | null; youtube_channel_id: string | null };

  /** Chaînes vérifiées du compte qui a créé le jeton ; choisit celle demandée (nom, @pseudo, ID UC) ou la seule. */
  async function pickMyChannel(query: string | undefined): Promise<{ channel?: MyChannel; error?: string }> {
    if (!token.userId) return { error: 'Ce jeton n’est rattaché à aucun compte. Crée un nouveau jeton dans Reglages > Connexion a Claude.' };
    const db = createServiceClient();
    const { data, error } = await db
      .from('user_channels')
      .select('id, title, handle, youtube_channel_id')
      .eq('user_id', token.userId)
      .not('verified_at', 'is', null);
    if (error) return { error: 'Impossible de lire tes chaines pour le moment.' };
    const mine = (data ?? []) as MyChannel[];
    if (!mine.length) return { error: 'Aucune chaine verifiee sur ce compte. Ajoute et verifie ta chaine dans Reglages > Mes chaines.' };
    if (!query) {
      if (mine.length === 1) return { channel: mine[0] };
      return { error: `Plusieurs chaines : precise laquelle avec le parametre channel. Tes chaines : ${mine.map((c) => c.title).join(', ')}.` };
    }
    const q = query.trim().toLowerCase().replace(/^@/, '');
    const hit = mine.find(
      (c) => c.youtube_channel_id?.toLowerCase() === q || (c.handle ?? '').toLowerCase().replace(/^@/, '') === q || c.title.toLowerCase() === q,
    ) ?? mine.find((c) => c.title.toLowerCase().includes(q));
    return hit ? { channel: hit } : { error: `Chaine introuvable parmi les tiennes : ${mine.map((c) => c.title).join(', ')}.` };
  }

  const nf = (v: number) => Math.round(v).toLocaleString('fr-FR');
  const money = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $`;
  const secs = (s: number) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`;

  // ── get_my_channel_stats ───────────────────────────────────────────

  mcp.tool(
    'get_my_channel_stats',
    'Statistiques d\'une de MES chaines verifiees : chiffres publics (vues habituelles, interactions, rythme, meilleur jour, Shorts vs longues, videos qui ont decolle, revenus estimes) et, si YouTube Analytics est connecte, les chiffres prives (vues, duree regardee, abonnes, sources de trafic, pays, appareils, age, revenus reels, RPM, CPM, meilleures videos). Lecture seule.',
    {
      channel: z.string().optional().describe('Nom, @pseudo ou ID UC de la chaine (facultatif si une seule chaine)'),
      period: z.enum(['7', '28', '90', '365']).optional().describe('Periode YouTube Analytics en jours (defaut 28)'),
    },
    async ({ channel, period }) => {
      const blocked = await guard(token, 'get_my_channel_stats');
      if (blocked) return fail(blocked);
      const picked = await pickMyChannel(channel);
      if (!picked.channel) return fail(picked.error ?? 'Chaine introuvable.');
      const ch = picked.channel;
      const db = createServiceClient();
      const per = (period ?? '28') as Period;
      const [pub, an] = await Promise.all([getPublicStats(db, ch.id), getChannelAnalytics(db, ch.id, per)]);
      const out: string[] = [`# ${ch.title}${ch.handle ? ` (${ch.handle})` : ''}`];

      if (pub) {
        const c = pub.channel;
        out.push(
          '',
          '## Chiffres publics',
          `Abonnes : ${c.subscribers === null ? 'masques' : nf(c.subscribers)} | Vues totales : ${c.totalViews === null ? '—' : nf(c.totalViews)} | Videos : ${c.videoCount ?? '—'}${c.nicheName ? ` | Thematique : ${c.nicheName}` : ''}`,
        );
        if (pub.sample) {
          out.push(
            `Sur les ${pub.sample} dernieres videos lues :`,
            `- Vues habituelles (mediane des longues) : ${nf(pub.medianViews)} ; moyenne ${nf(pub.averageViews)}`,
            `- Interactions : ${pub.engagementRate.toFixed(2)} % (j'aime ${pub.likeRate.toFixed(2)} %, commentaires ${pub.commentRate.toFixed(2)} %)`,
            `- Rythme : ${pub.uploadsPerWeek.toFixed(1)} video(s)/semaine${pub.daysSinceLast !== null ? `, derniere il y a ${pub.daysSinceLast} j` : ''}`,
            `- Meilleur jour de publication : ${pub.bestWeekday ? `${pub.bestWeekday.day} (${nf(pub.bestWeekday.median)} vues habituelles)` : 'pas assez de videos'}`,
            `- Videos longues : ${pub.long.count} (vues habituelles ${nf(pub.long.median)}) | Shorts : ${pub.shorts.count} (vues habituelles ${nf(pub.shorts.median)})`,
          );
          if (pub.estimate) {
            out.push(`- Revenus estimes (vues longues x RPM de la thematique ${pub.estimate.rpmLow}-${pub.estimate.rpmHigh} $) : ${money(pub.estimate.low)} a ${money(pub.estimate.high)} — estimation seulement`);
          }
          if (pub.outliers.length) {
            out.push('', 'Videos qui ont decolle (>= 2x les vues habituelles du format) :');
            for (const v of pub.outliers) out.push(`- ${v.title} — ${nf(v.views)} vues (x${(v.ratio ?? 0).toFixed(1)}${v.isShort ? ', Short' : ''}) https://youtube.com/watch?v=${v.id}`);
          }
        }
      }

      out.push('', `## YouTube Analytics (${PERIODS.find((p) => p.key === per)?.label})`);
      if (an.status === 'absent') {
        out.push('Non connecte. Pour les chiffres prives et les revenus reels : TubLyTI > Mes videos > Ma chaine > « Connecter YouTube Analytics ».');
      } else if (an.status === 'erreur') {
        out.push(an.reason === 'acces-retire' ? 'Acces retire dans le compte Google : reconnecter depuis Ma chaine.' : 'YouTube Analytics ne repond pas pour le moment.');
      } else {
        const d = an.data;
        const t = d.totals;
        const subTotal = d.subscribed.subscribed + d.subscribed.notSubscribed;
        out.push(
          `Du ${d.startDate} au ${d.endDate} (chiffres consolides avec ~2 jours de retard)`,
          `- Vues : ${nf(t.views)} | Heures regardees : ${nf(t.minutesWatched / 60)}`,
          `- Duree moyenne regardee : ${secs(t.averageViewDuration)} (${t.averageViewPercentage.toFixed(0)} % de la video)`,
          `- Abonnes : +${nf(t.subscribersGained)} / -${nf(t.subscribersLost)} (net ${nf(t.subscribersGained - t.subscribersLost)})`,
          `- J'aime ${nf(t.likes)} | Commentaires ${nf(t.comments)} | Partages ${nf(t.shares)}`,
          subTotal ? `- Vues venant d'abonnes : ${((d.subscribed.subscribed / subTotal) * 100).toFixed(0)} %` : '',
        );
        if (d.revenue) {
          const r = d.revenue;
          out.push(`- Revenus estimes : ${money(r.estimatedRevenue)} | RPM ${money(r.rpm)} | CPM ${money(r.cpm)} | Lectures monetisees ${nf(r.monetizedPlaybacks)}`);
        } else if (d.revenueNote) {
          out.push(`- Revenus : ${d.revenueNote}`);
        }
        const total = (rows: { views: number }[]) => rows.reduce((a, x) => a + x.views, 0) || 1;
        if (d.traffic.length) out.push(`- Sources de trafic : ${d.traffic.slice(0, 6).map((x) => `${x.key} ${((x.views / total(d.traffic)) * 100).toFixed(0)} %`).join(', ')}`);
        if (d.countries.length) out.push(`- Pays : ${d.countries.slice(0, 6).map((x) => `${x.key} ${((x.views / total(d.countries)) * 100).toFixed(0)} %`).join(', ')}`);
        if (d.devices.length) out.push(`- Appareils : ${d.devices.map((x) => `${x.key} ${((x.views / total(d.devices)) * 100).toFixed(0)} %`).join(', ')}`);
        if (d.demographics.length) out.push(`- Age (part des spectateurs connectes) : ${d.demographics.map((x) => `${x.age} ${(x.male + x.female + x.other).toFixed(0)} %`).join(', ')}`);
        if (d.topVideos.length) {
          out.push('', 'Meilleures videos de la periode (utilise get_video_retention pour voir ou les spectateurs decrochent) :');
          for (const v of d.topVideos) {
            out.push(`- ${v.title} — ${nf(v.views)} vues, duree moyenne ${secs(v.avgDuration)} (${v.avgPercent.toFixed(0)} %), +${nf(v.subscribers)} abonnes${v.revenue !== null ? `, ${money(v.revenue)}` : ''} [video ${v.id}]`);
          }
        }
      }
      return ok(out.filter((l) => l !== '').join('\n').replace(/\n## /g, '\n\n## '));
    },
  );

  // ── get_video_retention ────────────────────────────────────────────

  mcp.tool(
    'get_video_retention',
    'Courbe de retention d\'une video d\'une de MES chaines (YouTube Analytics doit etre connecte) : part des spectateurs encore presents au fil de la video, plus forte chute, comparaison avec les videos YouTube de meme duree. Lecture seule.',
    {
      video: z.string().describe('Lien YouTube ou ID de la video (11 caracteres)'),
      channel: z.string().optional().describe('Nom, @pseudo ou ID UC de la chaine (facultatif si une seule chaine)'),
    },
    async ({ video, channel }) => {
      const blocked = await guard(token, 'get_video_retention');
      if (blocked) return fail(blocked);
      const id = video.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([\w-]{11})/)?.[1] ?? (/^[\w-]{11}$/.test(video.trim()) ? video.trim() : null);
      if (!id) return fail('Lien ou ID de video invalide.');
      const db = createServiceClient();

      // La video doit appartenir a une des chaines verifiees du compte.
      let ch: MyChannel | undefined;
      if (channel) {
        const picked = await pickMyChannel(channel);
        if (!picked.channel) return fail(picked.error ?? 'Chaine introuvable.');
        ch = picked.channel;
      } else {
        const { data: v } = await db.from('videos').select('channel_id').eq('id', id).maybeSingle();
        const { data: mine } = await db
          .from('user_channels')
          .select('id, title, handle, youtube_channel_id')
          .eq('user_id', token.userId ?? '00000000-0000-0000-0000-000000000000')
          .not('verified_at', 'is', null);
        const list = (mine ?? []) as MyChannel[];
        ch = list.find((c) => c.youtube_channel_id && c.youtube_channel_id === v?.channel_id) ?? (list.length === 1 ? list[0] : undefined);
        if (!ch) return fail(list.length ? 'Video introuvable sur tes chaines : precise le parametre channel.' : 'Aucune chaine verifiee sur ce compte.');
      }

      const res = await getVideoRetention(db, ch.id, id);
      if (res.status === 'absent') return fail('YouTube Analytics n\'est pas connecte pour cette chaine (TubLyTI > Ma chaine > « Connecter YouTube Analytics »).');
      if (res.status === 'erreur') {
        return fail(
          res.reason === 'vide'
            ? 'YouTube n\'a pas encore assez de vues pour calculer la retention de cette video.'
            : res.reason === 'acces-retire'
              ? 'Acces YouTube Analytics retire : reconnecter depuis Ma chaine.'
              : 'Retention indisponible (video d\'une autre chaine, ou YouTube ne repond pas).',
        );
      }
      const pts = res.data.points;
      const at = (r: number) => pts.reduce((b, p) => (Math.abs(p.at - r) < Math.abs(b.at - r) ? p : b), pts[0]).watch;
      let drop = { at: 0, size: 0 };
      for (let i = 1; i < pts.length; i++) {
        const d = pts[i - 1].watch - pts[i].watch;
        if (pts[i].at > 0.03 && d > drop.size) drop = { at: pts[i].at, size: d };
      }
      const rel = res.data.relativeAvg;
      const lines = [
        `# Retention — video ${id} (${ch.title})`,
        `Spectateurs encore presents : ${[0.05, 0.1, 0.25, 0.5, 0.75, 0.95].map((r) => `${Math.round(r * 100)} % → ${(at(r) * 100).toFixed(0)} %`).join(' | ')}`,
        drop.size > 0.03 ? `Plus forte chute : ${(drop.size * 100).toFixed(1)} points vers ${Math.round(drop.at * 100)} % de la video.` : 'Pas de chute brutale.',
        rel === null
          ? ''
          : `Comparaison aux videos YouTube de meme duree : ${rel >= 0.6 ? 'meilleure que la plupart' : rel <= 0.4 ? 'moins bonne que la plupart' : 'dans la moyenne'} (score ${rel.toFixed(2)}, 0,5 = moyenne).`,
        'Une valeur au-dessus de 100 % signifie que des spectateurs reviennent en arriere ou revoient ce passage.',
        `https://youtube.com/watch?v=${id}`,
      ];
      return ok(lines.filter(Boolean).join('\n'));
    },
  );

  // ── Contrat « analytics » pour les outils de production (JSON) ─────
  // list_my_channels · list_my_videos · get_video_performance (+ get_video_retention ci-dessus).
  // Réponses en JSON pour être lues par un programme ; lecture seule ; chaînes vérifiées du jeton uniquement.

  const json = (v: unknown) => ok(JSON.stringify(v, null, 2));

  async function myVerifiedChannels() {
    if (!token.userId) return [] as (MyChannel & { niche_id: string | null; subscriber_count: number | null })[];
    const { data } = await createServiceClient()
      .from('user_channels')
      .select('id, title, handle, youtube_channel_id, niche_id, subscriber_count')
      .eq('user_id', token.userId)
      .not('verified_at', 'is', null);
    return (data ?? []) as (MyChannel & { niche_id: string | null; subscriber_count: number | null })[];
  }

  mcp.tool(
    'list_my_channels',
    'Liste MES chaines YouTube verifiees (JSON) : channel_id (UC…), nom, @pseudo, abonnes, thematique, analytics_connected (YouTube Analytics connecte ou non).',
    {},
    async () => {
      const blocked = await guard(token, 'list_my_channels');
      if (blocked) return fail(blocked);
      const db = createServiceClient();
      const mine = await myVerifiedChannels();
      const ids = mine.map((c) => c.id);
      const [{ data: toks }, { data: niches }] = await Promise.all([
        ids.length ? db.from('user_channel_tokens').select('user_channel_id').in('user_channel_id', ids) : Promise.resolve({ data: [] }),
        db.from('niches').select('id, name'),
      ]);
      const connected = new Set(((toks ?? []) as { user_channel_id: string }[]).map((t) => t.user_channel_id));
      const nicheName = new Map(((niches ?? []) as { id: string; name: string }[]).map((n) => [n.id, n.name]));
      // Liste vide : on dit pourquoi, pour que l'outil appelant puisse guider l'utilisateur.
      let reason: string | null = null;
      if (!mine.length) {
        if (!token.userId) {
          reason = 'token_without_account';
        } else {
          const { count } = await db.from('user_channels').select('id', { count: 'exact', head: true }).eq('user_id', token.userId);
          reason = count ? 'no_verified_channel' : 'no_channel';
        }
      }
      return json({
        ...(reason
          ? {
              reason,
              help:
                reason === 'token_without_account'
                  ? 'Ce jeton date d\'avant les comptes personnels et n\'est rattache a aucun compte. Cree un nouveau jeton dans TubLyTI > Reglages > Connexion a Claude (connecte avec le compte qui possede tes chaines) et remplace l\'ancien.'
                  : reason === 'no_verified_channel'
                    ? 'Le compte du jeton a des chaines, mais aucune n\'est verifiee. TubLyTI > Reglages > Mes chaines > Verifier.'
                    : 'Le compte du jeton n\'a aucune chaine. Ajoute ta chaine dans TubLyTI > Reglages > Mes chaines, ou cree le jeton depuis le compte qui possede tes chaines.',
            }
          : {}),
        channels: mine.map((c) => ({
          channel_id: c.youtube_channel_id,
          name: c.title,
          handle: c.handle,
          subscribers: c.subscriber_count,
          niche: c.niche_id ? nicheName.get(c.niche_id) ?? null : null,
          analytics_connected: connected.has(c.id),
        })),
      });
    },
  );

  mcp.tool(
    'list_my_videos',
    'Liste les videos publiees d\'une de MES chaines (JSON), les plus recentes d\'abord : video_id, titre, date, duree, vues, j\'aime, commentaires, format (long/short).',
    {
      channel: z.string().optional().describe('Nom, @pseudo ou ID UC de la chaine (facultatif si une seule chaine)'),
      limit: z.number().optional().describe('Nombre de videos (defaut 20, max 50)'),
    },
    async ({ channel, limit }) => {
      const blocked = await guard(token, 'list_my_videos');
      if (blocked) return fail(blocked);
      const picked = await pickMyChannel(channel);
      if (!picked.channel?.youtube_channel_id) return fail(picked.error ?? 'Chaine non reliee a YouTube.');
      const db = createServiceClient();
      const { data: vids } = await db
        .from('videos')
        .select('id, title, published_at, duration_s')
        .eq('channel_id', picked.channel.youtube_channel_id)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(Math.min(limit ?? 20, 50));
      const list = (vids ?? []) as { id: string; title: string; published_at: string | null; duration_s: number | null }[];
      const stats = new Map<string, { views: number; likes: number; comments: number }>();
      for (const [vid, sn] of await getLatestSnapshots(db, list.map((v) => v.id))) {
        stats.set(vid, { views: Number(sn.views) || 0, likes: Number(sn.likes) || 0, comments: Number(sn.comments) || 0 });
      }
      return json({
        channel_id: picked.channel.youtube_channel_id,
        videos: list.map((v) => ({
          video_id: v.id,
          title: v.title,
          published_at: v.published_at,
          duration_s: v.duration_s,
          format: (v.duration_s ?? 0) > 0 && (v.duration_s ?? 0) <= 180 ? 'short' : 'long',
          views: stats.get(v.id)?.views ?? null,
          likes: stats.get(v.id)?.likes ?? null,
          comments: stats.get(v.id)?.comments ?? null,
          url: `https://youtube.com/watch?v=${v.id}`,
        })),
      });
    },
  );

  mcp.tool(
    'get_video_performance',
    'Performance d\'une video d\'une de MES chaines (JSON) : vues, duree moyenne regardee, % vu, abonnes gagnes, interactions, courbe de retention (point par point, en secondes et en part de la video), plus forte chute, comparaison aux videos de meme duree, et CTR/impressions des miniatures quand ils sont disponibles. Necessite YouTube Analytics connecte pour les chiffres prives.',
    {
      video: z.string().describe('Lien YouTube ou ID de la video (11 caracteres)'),
    },
    async ({ video }) => {
      const blocked = await guard(token, 'get_video_performance');
      if (blocked) return fail(blocked);
      const id = video.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([\w-]{11})/)?.[1] ?? (/^[\w-]{11}$/.test(video.trim()) ? video.trim() : null);
      if (!id) return fail('Lien ou ID de video invalide.');
      const db = createServiceClient();
      const { data: v } = await db.from('videos').select('id, title, published_at, duration_s, channel_id').eq('id', id).maybeSingle();
      const mine = await myVerifiedChannels();
      const ch = mine.find((c) => c.youtube_channel_id && c.youtube_channel_id === v?.channel_id);
      if (!v || !ch) return fail('Video introuvable sur tes chaines verifiees (elle apparait apres la collecte de nuit qui suit sa publication).');

      const [{ data: snap }, totals, ret, { data: tok }, reach, { data: job }] = await Promise.all([
        db.from('video_snapshots').select('views, likes, comments, captured_at').eq('video_id', id).order('captured_at', { ascending: false }).limit(1).maybeSingle(),
        getVideoTotals(db, ch.id, id),
        getVideoRetention(db, ch.id, id),
        db.from('user_channel_tokens').select('user_channel_id').eq('user_channel_id', ch.id).maybeSingle(),
        getVideoReach(db, ch.id, id).catch(() => null),
        db.from('reporting_jobs').select('created_at, last_sync_at, last_error').eq('user_channel_id', ch.id).maybeSingle(),
      ]);
      const lengthS = (v.duration_s as number | null) ?? null;
      const points = ret.status === 'ok' ? ret.data.points : [];
      let drop: { t_ratio: number; t_seconds: number | null; size: number } | null = null;
      for (let i = 1; i < points.length; i++) {
        const d = points[i - 1].watch - points[i].watch;
        if (points[i].at > 0.03 && d > (drop?.size ?? 0.03)) drop = { t_ratio: points[i].at, t_seconds: lengthS ? Math.round(points[i].at * lengthS) : null, size: Number(d.toFixed(4)) };
      }
      return json({
        video_id: id,
        title: v.title,
        published_at: v.published_at,
        duration_s: lengthS,
        analytics_connected: Boolean(tok),
        public: snap ? { views: Number(snap.views) || 0, likes: Number(snap.likes) || 0, comments: Number(snap.comments) || 0, as_of: snap.captured_at } : null,
        analytics: totals
          ? {
              views: totals.views,
              watch_time_minutes: totals.minutesWatched,
              avg_view_duration_s: totals.averageViewDuration,
              avg_view_percentage: totals.averageViewPercentage,
              subscribers_gained: totals.subscribersGained,
              likes: totals.likes,
              comments: totals.comments,
              shares: totals.shares,
            }
          : null,
        retention:
          ret.status === 'ok'
            ? {
                points: points.map((p) => ({ t_ratio: p.at, t_seconds: lengthS ? Math.round(p.at * lengthS) : null, watch_ratio: p.watch })),
                relative_to_similar_videos: ret.data.relativeAvg,
                biggest_drop: drop,
              }
            : { unavailable: ret.status === 'absent' ? 'analytics_not_connected' : ret.reason },
        thumbnail: reach
          ? {
              impressions: reach.impressions,
              ctr: reach.ctr,
              first_day: reach.first_day,
              last_day: reach.last_day,
              daily: reach.daily,
            }
          : {
              impressions: null,
              ctr: null,
              unavailable: !tok
                ? 'analytics_not_connected'
                : !job
                  ? 'report_job_pending'
                  : (job as { last_error?: string | null }).last_error
                    ? 'report_error'
                    : 'no_data_yet',
            },
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  //  PROMPT
  // ────────────────────────────────────────────────────────────────────

  mcp.tool(
    'analyze_video',
    'Analyse le CONTENU d\'une video YouTube publique (JSON) : l\'IA regarde l\'image, ecoute l\'audio et lit le texte a l\'ecran. Renvoie resume, accroche (dit/montre/promesse/technique), structure par parties avec horaires, forme (style, visuels, voix, musique, rythme, coupes/min), relances d\'attention, appels a l\'action, pourquoi ca marche, points faibles, quoi reprendre, transcription. Pour une video d\'une de MES chaines avec Analytics connecte, explique aussi ce qui se passe a chaque decrochage de retention (retention_notes). Resultat garde en cache : une video deja analysee revient instantanement. Prend 30 s a 2 min la premiere fois.',
    {
      video: z.string().describe('Lien YouTube ou ID de la video (11 caracteres)'),
      force: z.boolean().optional().describe('Refaire l\'analyse meme si elle existe deja (administrateur uniquement)'),
    },
    async ({ video, force }) => {
      const blocked = await guard(token, 'analyze_video');
      if (blocked) return fail(blocked);
      const id = parseVideoId(video);
      if (!id) return fail(JSON.stringify({ error: 'invalid', message: 'Lien ou ID de video invalide.' }));
      const db = createServiceClient();

      // Video d'une de mes chaines : on ajoute la courbe de retention.
      let retention: RetentionContext | null = null;
      const { data: v } = await db.from('videos').select('channel_id').eq('id', id).maybeSingle();
      if (v?.channel_id) {
        const ch = (await myVerifiedChannels()).find((c) => c.youtube_channel_id === v.channel_id);
        if (ch) {
          const ret = await getVideoRetention(db, ch.id, id).catch(() => null);
          if (ret?.status === 'ok') retention = retentionContextFrom(ret.data.points);
        }
      }

      const res = await analyzeVideo(db, id, { userId: token.userId, retention, force: Boolean(force && token.isAdmin) });
      if (!res.ok) return fail(JSON.stringify({ error: res.reason, message: res.message }));
      const r = res.row;
      return json({
        video_id: r.videoId,
        url: `https://www.youtube.com/watch?v=${r.videoId}`,
        title: r.title,
        channel_title: r.channelTitle,
        duration_s: r.durationS,
        analyzed_at: r.updatedAt,
        model: r.model,
        cached: res.cached,
        with_retention: Boolean(r.analysis?.retention_notes.length),
        analysis: r.analysis,
      });
    },
  );

  mcp.tool(
    'check_saturation',
    'Le sujet ou la video est-il sature ? (JSON) Pour un sujet (topic_id) : niveau open|filling|saturated, score 0-100, chaines ayant publie ces 30 jours, rythme de publication avant/apres, performance des nouvelles videos vs anciennes, conseil. Pour n\'importe quelle video YouTube (video, meme hors catalogue : niche detectee automatiquement) : combien de fois son idee a ete copiee dans la niche depuis, par combien de chaines, et si les copies marchent encore.',
    {
      topic_id: z.string().uuid().optional().describe('ID du sujet'),
      video: z.string().optional().describe('Lien YouTube ou ID de la video'),
    },
    async ({ topic_id, video }) => {
      const blocked = await guard(token, 'check_saturation', topic_id ? { topicId: topic_id } : undefined);
      if (blocked) return fail(blocked);
      const db = createServiceClient();
      if (topic_id) return json({ topic_id, ...(await topicSaturation(db, topic_id)) });
      const id = video ? parseVideoId(video) : null;
      if (!id) return fail('Donne topic_id ou video.');
      const r = await linkSaturation(db, id, token.nicheIds ?? []);
      if ('error' in r) return fail(r.error);
      return json(r);
    },
  );

  mcp.tool(
    'compare_keywords',
    'Quel mot attire le plus ? (JSON) Compare 2 a 4 mots-cles sur les videos du catalogue qui les ont dans leur titre : nombre de videos, vues medianes, sur-performance mediane (vues / vues habituelles de la chaine), part a 2x et plus, meilleures videos, gagnant et verdict. scope "niche" (thematiques du jeton) ou "all".',
    {
      terms: z.array(z.string().min(2).max(60)).min(2).max(4).describe('Mots ou sujets a comparer'),
      scope: z.enum(['niche', 'all']).optional().describe('niche (par defaut) ou all'),
    },
    async ({ terms, scope }) => {
      const blocked = await guard(token, 'compare_keywords');
      if (blocked) return fail(blocked);
      const nicheIds = scope === 'all' ? null : token.nicheIds;
      return json(await compareKeywords(createServiceClient(), terms, nicheIds && nicheIds.length ? nicheIds : null));
    },
  );

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
