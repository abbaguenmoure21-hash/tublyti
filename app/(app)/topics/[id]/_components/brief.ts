import { toast } from 'sonner';
import { COMMENT_LABELS, FRUSTRATION_LABEL, formatLongDate, formatSupply } from '@/lib/lexique';

export interface BriefAngle {
  id: string;
  title: string;
  hook: string;
  rationale: string;
}

export interface BriefData {
  topicLabel: string;
  nicheName: string;
  rpmCoefficient: number;
  phaseLabel: string;
  mgi: number | null;
  /** 0..1 */
  demand: number | null;
  supply: number | null;
  /** 0..1 */
  frustrationScore: number | null;
  monetization: number | null;
  date: string;
  frustrations: {
    text: string;
    likeCount: number;
    label?: string;
    requestedAngle: string | null;
    commentId: string;
    videoId?: string;
  }[];
  competitors: {
    title: string;
    channelTitle: string;
    views: number;
    videoId: string;
  }[];
}

/** Markdown brief for a topic, with or without a chosen angle (LEXIQUE wording). */
export function buildBrief(angle: BriefAngle | null, data: BriefData): string {
  const fr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const lines: string[] = [
    `# Brief — ${angle?.title ?? data.topicLabel}`,
    '',
    `**Date :** ${formatLongDate(data.date)}`,
    `**Sujet :** ${data.topicLabel}`,
    `**Thématique :** ${data.nicheName}`,
    `**Moment :** ${data.phaseLabel}`,
    '',
    `## Les chiffres`,
    '',
    data.mgi !== null ? `- **Potentiel :** ${Math.round(data.mgi)} / 100` : '',
    data.demand !== null ? `- **Demande du public :** ${Math.round(data.demand * 100)} / 100` : '',
    data.supply !== null ? `- **Vidéos de qualité existantes :** ${formatSupply(data.supply)} par rapport à la moyenne` : '',
    data.frustrationScore !== null ? `- **${FRUSTRATION_LABEL} :** ${Math.round(data.frustrationScore * 100)} %` : '',
    data.monetization !== null ? `- **Revenus publicitaires :** ×${fr.format(data.monetization)} par rapport à une thématique moyenne` : '',
    '',
  ];

  if (angle) {
    lines.push(
      `## Angle choisi`,
      '',
      `**Titre :** ${angle.title}`,
      angle.hook ? `**Accroche :** ${angle.hook}` : '',
      angle.rationale ? `**Pourquoi cet angle :** ${angle.rationale}` : '',
      '',
    );
  }

  const quotes = data.frustrations.slice(0, 10);
  if (quotes.length) {
    lines.push(`## Ce que réclame le public (${quotes.length} commentaire${quotes.length > 1 ? 's' : ''})`, '');
    for (const f of quotes) {
      const kind = f.label && COMMENT_LABELS[f.label] ? `${COMMENT_LABELS[f.label]} ` : '';
      const angleNote = f.requestedAngle ? ` → ${f.requestedAngle}` : '';
      const link = f.videoId ? ` ([commentaire](https://www.youtube.com/watch?v=${f.videoId}&lc=${f.commentId}))` : '';
      lines.push(`- ${kind}[${f.likeCount} j’aime] ${f.text.slice(0, 200)}${angleNote}${link}`);
    }
    lines.push('');
  }

  const competitors = data.competitors.slice(0, 5);
  if (competitors.length) {
    lines.push(`## Vidéos déjà publiées (${competitors.length})`, '');
    for (const c of competitors) {
      const views = c.views >= 1000 ? `${fr.format(c.views / 1000)} k` : String(c.views);
      lines.push(`- ${c.title} (${c.channelTitle}) — ${views} vues ([lien](https://www.youtube.com/watch?v=${c.videoId}))`);
    }
  }

  return lines.filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n').trim() + '\n';
}

/** Copies the brief and confirms with a toast. Returns true on success. */
export async function copyBrief(angle: BriefAngle | null, data: BriefData): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(buildBrief(angle, data));
    toast.success('Brief copié. Tu peux le coller où tu veux.');
    return true;
  } catch {
    toast.error('Impossible de copier le brief. Réessaie.');
    return false;
  }
}

export function downloadBrief(angle: BriefAngle | null, data: BriefData) {
  const slug = data.topicLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const blob = new Blob([buildBrief(angle, data)], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `brief-${slug}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('Brief téléchargé.');
}
