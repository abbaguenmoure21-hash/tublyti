import { createServiceClient } from '@/lib/supabase/server';
import { getMgiBand } from '@/lib/scoring/mgi';

// ── Types ────────────────────────────────────────────────────────────

export interface DossierData {
  topic: {
    id: string;
    label: string;
    phase: number | null;
    status: string;
    createdAt: string;
  };
  niche: {
    id: string;
    name: string;
    rpmCoefficient: number;
    rpmLow: number | null;
    rpmHigh: number | null;
    rpmSource: string | null;
  } | null;
  score: {
    mgi: number;
    demand: number;
    frustration: number;
    supplyQ: number;
    monetization: number;
    phase: number;
    scoredAt: string;
    confidence: string | null;
    confidenceReason: string | null;
    feasibilityGrade: string | null;
    feasibilityReason: string | null;
  } | null;
  frustrations: {
    text: string;
    likeCount: number;
    label: string;
    requestedAngle: string | null;
    videoId: string;
    commentId: string;
  }[];
  competitors: {
    id: string;
    title: string;
    channelTitle: string;
    views: number;
    publishedAt: string;
    durationSec: number;
    subscriberCount: number | null;
  }[];
  titlePatterns: {
    formula: string;
    description: string;
    examples: string[];
    frequency: number;
    emotionalTriggers: string[];
  }[];
  angles: {
    title: string;
    hook: string;
    rationale: string;
    formula: string | null;
    frustrationResolved: string | null;
  }[];
  sparkline: number[];
}

// ── Fetch ────────────────────────────────────────────────────────────

export async function fetchDossierData(topicId: string): Promise<DossierData | null> {
  const db = createServiceClient();

  const { data: topic } = await db
    .from('topics')
    .select('id, label, phase, status, created_at, niche_id, niches(id, name, rpm_coefficient, rpm_low, rpm_high, rpm_source)')
    .eq('id', topicId)
    .single();

  if (!topic) return null;

  const nicheRaw = topic.niches as unknown as {
    id: string; name: string; rpm_coefficient: number;
    rpm_low: number | null; rpm_high: number | null; rpm_source: string | null;
  } | null;

  const niche = nicheRaw ? {
    id: nicheRaw.id,
    name: nicheRaw.name,
    rpmCoefficient: nicheRaw.rpm_coefficient,
    rpmLow: nicheRaw.rpm_low,
    rpmHigh: nicheRaw.rpm_high,
    rpmSource: nicheRaw.rpm_source,
  } : null;

  // Latest score
  const { data: scoreRow } = await db
    .from('topic_scores')
    .select('mgi, demand, frustration, supply_q, monetization, phase, scored_at, confidence, confidence_reason, feasibility_grade, feasibility_reason')
    .eq('topic_id', topicId)
    .order('scored_at', { ascending: false })
    .limit(1)
    .single();

  const score = scoreRow ? {
    mgi: Number(scoreRow.mgi),
    demand: Number(scoreRow.demand),
    frustration: Number(scoreRow.frustration),
    supplyQ: Number(scoreRow.supply_q),
    monetization: Number(scoreRow.monetization),
    phase: scoreRow.phase as number,
    scoredAt: scoreRow.scored_at as string,
    confidence: (scoreRow.confidence as string) ?? null,
    confidenceReason: (scoreRow.confidence_reason as string) ?? null,
    feasibilityGrade: (scoreRow.feasibility_grade as string) ?? null,
    feasibilityReason: (scoreRow.feasibility_reason as string) ?? null,
  } : null;

  // Frustrations (top 10)
  const { data: frustRows } = await db
    .from('comment_labels')
    .select(`
      label, requested_angle, confidence,
      comments!inner(id, text, like_count, video_id, videos!inner(topic_id))
    `)
    .eq('comments.videos.topic_id', topicId)
    .neq('label', 'none')
    .gte('confidence', 0.7)
    .order('comments(like_count)', { ascending: false })
    .limit(10);

  const frustrations = (frustRows ?? []).map((f: Record<string, unknown>) => {
    const comment = f.comments as unknown as {
      id: string; text: string; like_count: number; video_id: string;
    };
    return {
      text: comment.text,
      likeCount: comment.like_count,
      label: f.label as string,
      requestedAngle: (f.requested_angle as string) ?? null,
      videoId: comment.video_id,
      commentId: comment.id,
    };
  });

  // Competitors (5 qualified)
  const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const { data: vids } = await db
    .from('videos')
    .select('id, title, published_at, duration_seconds, channel_id, channels(title, subscriber_count)')
    .eq('topic_id', topicId)
    .eq('is_qualified', true)
    .gte('published_at', sixMonthsAgo)
    .order('published_at', { ascending: false })
    .limit(5);

  const videoIds = (vids ?? []).map((v: Record<string, unknown>) => v.id as string);
  const videoViews: Record<string, number> = {};
  if (videoIds.length > 0) {
    const { data: snaps } = await db
      .from('video_snapshots')
      .select('video_id, views')
      .in('video_id', videoIds)
      .order('captured_at', { ascending: false });
    const seen = new Set<string>();
    for (const s of snaps ?? []) {
      if (!seen.has(s.video_id)) {
        seen.add(s.video_id);
        videoViews[s.video_id] = s.views ?? 0;
      }
    }
  }

  const competitors = (vids ?? []).map((v: Record<string, unknown>) => {
    const ch = v.channels as unknown as { title: string; subscriber_count: number | null } | null;
    const vid = v.id as string;
    return {
      id: vid,
      title: v.title as string,
      channelTitle: ch?.title ?? '',
      views: videoViews[vid] ?? 0,
      publishedAt: v.published_at as string,
      durationSec: (v.duration_seconds as number) ?? 0,
      subscriberCount: ch?.subscriber_count ?? null,
    };
  });

  // Title patterns
  let titlePatterns: DossierData['titlePatterns'] = [];
  if (niche) {
    const { data: patterns } = await db
      .from('title_patterns')
      .select('formula, description, examples, frequency, emotional_triggers')
      .eq('niche_id', niche.id)
      .order('frequency', { ascending: false })
      .limit(10);

    titlePatterns = (patterns ?? []).map((p: Record<string, unknown>) => ({
      formula: p.formula as string,
      description: p.description as string,
      examples: (p.examples as string[]) ?? [],
      frequency: Number(p.frequency),
      emotionalTriggers: (p.emotional_triggers as string[]) ?? [],
    }));
  }

  // Angles (latest 5)
  const { data: angleRows } = await db
    .from('angles')
    .select('title, hook, rationale, formula, frustration_resolved')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: false })
    .limit(5);

  const angles = (angleRows ?? []).map((a: Record<string, unknown>) => ({
    title: a.title as string,
    hook: a.hook as string,
    rationale: a.rationale as string,
    formula: (a.formula as string) ?? null,
    frustrationResolved: (a.frustration_resolved as string) ?? null,
  }));

  // Sparkline (30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data: trendPoints } = await db
    .from('trend_points')
    .select('value')
    .eq('topic_id', topicId)
    .eq('source', 'trends')
    .gte('captured_at', thirtyDaysAgo)
    .order('captured_at', { ascending: true });

  const sparkline = (trendPoints ?? []).map((p: Record<string, unknown>) => Number(p.value));

  return {
    topic: {
      id: topic.id as string,
      label: topic.label as string,
      phase: (topic.phase as number) ?? null,
      status: topic.status as string,
      createdAt: topic.created_at as string,
    },
    niche,
    score,
    frustrations,
    competitors,
    titlePatterns,
    angles,
    sparkline,
  };
}

// ── Markdown rendering ───────────────────────────────────────────────

const PHASE_LABELS: Record<number, string> = {
  0: 'À surveiller',
  1: 'Ça monte',
  2: 'C’est le moment',
  3: 'Trop tard',
};

const LABEL_NAMES: Record<string, string> = {
  no_one_explains: "Personne n'explique",
  wish_video_on: 'Souhait de vidéo',
  stopped_too_early: "S'arrête trop tôt",
  searched_long: 'Longue recherche',
};

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return String(n);
}

export function renderDossierMarkdown(data: DossierData): string {
  const { topic, niche, score, frustrations, competitors, titlePatterns, angles, sparkline } = data;

  const lines: string[] = [];
  const phase = score?.phase ?? topic.phase;

  lines.push(`# Dossier : ${topic.label}`);
  lines.push('');
  lines.push(`**Niche** : ${niche?.name ?? '—'} | **Phase** : ${phase !== null ? PHASE_LABELS[phase] ?? `Phase ${phase}` : 'Inconnue'} | **Statut** : ${topic.status}`);
  lines.push(`**Généré le** : ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`);

  // ── MGI breakdown
  if (score) {
    const band = getMgiBand(score.mgi);
    lines.push('');
    lines.push('## Market Gap Index');
    lines.push('');
    lines.push(`| Métrique | Valeur |`);
    lines.push(`|----------|--------|`);
    lines.push(`| **MGI** | **${Math.round(score.mgi)}** (${band.label}) |`);
    lines.push(`| Demande (D) | ${Math.round(score.demand)} |`);
    lines.push(`| Frustration (F) | ${Math.round(score.frustration * 100)} % |`);
    lines.push(`| Offre qualifiée (Oq) | ${Math.round(score.supplyQ)} |`);
    lines.push(`| Monétisation (P) | × ${score.monetization.toFixed(1)} |`);

    if (score.confidence) {
      const confLabel = score.confidence === 'high' ? 'Élevée' : score.confidence === 'medium' ? 'Moyenne' : 'Faible';
      lines.push(`| Confiance | ${confLabel} — ${score.confidenceReason ?? ''} |`);
    }
    lines.push(`| Fraîcheur | Scores du ${score.scoredAt} |`);
  }

  // ── Feasibility
  if (score?.feasibilityGrade) {
    lines.push('');
    lines.push('## Faisabilité');
    lines.push('');
    lines.push(`**Note : ${score.feasibilityGrade}** — ${score.feasibilityReason ?? 'Aucune explication.'}`);
  }

  // ── Phase + trend
  if (sparkline.length > 0) {
    lines.push('');
    lines.push('## Courbe de tendance (30 j)');
    lines.push('');
    const max = Math.max(...sparkline);
    const normalized = sparkline.map((v) => Math.round((v / (max || 1)) * 8));
    const bars = normalized.map((v) => '▁▂▃▄▅▆▇█'[v] ?? '▁');
    lines.push(`\`${bars.join('')}\` (min ${Math.round(Math.min(...sparkline))} → max ${Math.round(max)})`);
  }

  // ── Frustrations
  if (frustrations.length > 0) {
    lines.push('');
    lines.push(`## Frustrations (${frustrations.length})`);
    lines.push('');
    for (const f of frustrations) {
      const label = LABEL_NAMES[f.label] ?? f.label;
      const ytLink = `https://youtube.com/watch?v=${f.videoId}&lc=${f.commentId}`;
      lines.push(`${frustrations.indexOf(f) + 1}. **[${f.likeCount} likes]** « ${f.text.slice(0, 200)} »`);
      lines.push(`   Type : ${label}${f.requestedAngle ? ` · Angle demandé : ${f.requestedAngle}` : ''} · [Voir sur YouTube](${ytLink})`);
    }
  }

  // ── Competitors
  if (competitors.length > 0) {
    lines.push('');
    lines.push(`## Concurrents qualifiés (${competitors.length})`);
    lines.push('');
    lines.push(`| # | Titre | Chaîne | Vues | Abonnés | Publiée |`);
    lines.push(`|---|-------|--------|------|---------|---------|`);
    for (const [i, c] of competitors.entries()) {
      const subs = c.subscriberCount ? formatViews(c.subscriberCount) : '—';
      const pubDate = new Date(c.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      lines.push(`| ${i + 1} | [${c.title}](https://youtube.com/watch?v=${c.id}) | ${c.channelTitle} | ${formatViews(c.views)} | ${subs} | ${pubDate} |`);
    }
  }

  // ── RPM
  if (niche) {
    lines.push('');
    lines.push('## Monétisation (RPM)');
    lines.push('');
    if (niche.rpmLow && niche.rpmHigh) {
      lines.push(`**${niche.rpmLow} – ${niche.rpmHigh} $** par 1 000 vues (${niche.rpmSource ?? `coefficient × ${niche.rpmCoefficient}`})`);
    } else {
      lines.push(`Coefficient niche : × ${niche.rpmCoefficient}`);
    }
  }

  // ── Title patterns
  if (titlePatterns.length > 0) {
    lines.push('');
    lines.push(`## Formules de titres (${titlePatterns.length})`);
    lines.push('');
    for (const p of titlePatterns) {
      lines.push(`### ${p.formula} (${p.frequency} occurrences)`);
      lines.push(`${p.description}`);
      if (p.emotionalTriggers.length > 0) {
        lines.push(`Déclencheurs : ${p.emotionalTriggers.join(', ')}`);
      }
      if (p.examples.length > 0) {
        lines.push(`Exemples : ${p.examples.slice(0, 3).map((e) => `*${e}*`).join(' · ')}`);
      }
      lines.push('');
    }
  }

  // ── Angles
  if (angles.length > 0) {
    lines.push('');
    lines.push(`## Angles de contenu (${angles.length})`);
    lines.push('');
    for (const [i, a] of angles.entries()) {
      lines.push(`### ${i + 1}. ${a.title}`);
      lines.push(`**Hook** : ${a.hook}`);
      lines.push(`**Raison** : ${a.rationale}`);
      if (a.formula) lines.push(`**Formule** : ${a.formula}`);
      if (a.frustrationResolved) lines.push(`**Frustration résolue** : ${a.frustrationResolved}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`*Dossier généré par TubLyTI — ${new Date().toISOString().slice(0, 10)}*`);

  return lines.join('\n');
}
