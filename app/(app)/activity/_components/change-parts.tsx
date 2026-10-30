import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, ExternalLink, Image as ImageIcon, Minus, TrendingDown, TrendingUp, Type } from 'lucide-react';
import { changeVerdict, type ChangeRow, type VerdictTone } from '@/lib/changes';

/* Shared formatting and rows for the two Veille pages (/activity and /activity/changes). */

const nf = new Intl.NumberFormat('fr-FR');
const compactNf = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

export const formatNumber = (n: number) => nf.format(n);
export const formatCompact = (n: number) => compactNf.format(n);
export const formatTimes = (m: number) => `×${m.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;

/** Display time zone. Server runs in UTC; users are mostly in Europe / West-Central Africa. */
export const DISPLAY_TZ = 'Europe/Paris';

/** « il y a 3 h », « il y a 2 j », then an absolute date after 7 days (DESIGN). */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'il y a moins d’une heure';
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: DISPLAY_TZ });
}

/** Video age, e.g. « 3 j », « 5 h ». */
export function ageLabel(fromIso: string, now = Date.now()): string {
  const h = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 3_600_000));
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} j`;
}

const VERDICT_ICON: Record<VerdictTone, typeof TrendingUp | null> = { up: TrendingUp, flat: Minus, down: TrendingDown, none: null };

export function VerdictBadge({ change }: { change: Pick<ChangeRow, 'effect' | 'reason'> }) {
  const v = changeVerdict(change);
  const Icon = VERDICT_ICON[v.tone];
  const tone = v.tone === 'up' ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 self-start rounded-full px-2.5 py-1 text-[12px] font-semibold ${tone}`}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {v.label}
    </span>
  );
}

/** « 1,2 k vues/jour avant → 3,4 k depuis (5 j) », same text on both pages. */
export function paceText(c: ChangeRow): string {
  const parts: string[] = [];
  parts.push(c.paceBefore !== null ? `${formatCompact(c.paceBefore)} vues/jour avant` : 'Rythme d’avant inconnu');
  if (c.paceAfter !== null) parts[0] += ` → ${formatCompact(c.paceAfter)} depuis (${formatNumber(c.daysAfter)} j)`;
  else if (c.reason === 'too_recent') parts.push('mesure dans 1 à 2 jours');
  if (c.reason === 'low_volume') parts.push('trop peu de vues pour juger');
  if (c.reason === 'too_young') parts.push('changé pendant le lancement');
  if (c.gainSince) parts.push(`+${formatCompact(c.gainSince)} vues depuis`);
  return parts.join(' · ');
}

export function KindBadge({ kind }: { kind: ChangeRow['kind'] }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-semibold text-muted-foreground">
      {kind === 'title_change' ? <Type className="h-3.5 w-3.5" aria-hidden="true" /> : <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />}
      {kind === 'title_change' ? 'Titre changé' : 'Miniature changée'}
    </span>
  );
}

export const ytThumb = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

/** Explicit actions under a row: open the topic in TubLyTI, open on YouTube. */
export function RowActions({ videoId, topic }: { videoId: string; topic?: { id: string; label: string } | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-[13px]">
      {topic && (
        <Link href={`/sujets?sujet=${topic.id}&moment=tous`} className="inline-flex min-h-10 items-center gap-1 font-medium text-primary md:min-h-0">
          Voir le sujet <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
      <a
        href={`https://www.youtube.com/watch?v=${videoId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-10 items-center gap-1 font-medium text-muted-foreground hover:text-foreground md:min-h-0"
      >
        Ouvrir sur YouTube <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">(nouvel onglet)</span>
      </a>
    </div>
  );
}

/** One title / thumbnail change, rendered identically on /activity and /activity/changes. */
export function ChangeItem({ change: c, topic, extraMeta }: { change: ChangeRow; topic?: { id: string; label: string } | null; extraMeta?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:px-5">
      <div className="flex shrink-0 items-center gap-2">
        {c.kind === 'thumbnail_change' && c.oldValue?.startsWith('http') ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.oldValue} alt="Ancienne miniature" loading="lazy" className="aspect-video w-[120px] rounded-[10px] bg-muted object-cover opacity-75" />
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.newValue?.startsWith('http') ? c.newValue : ytThumb(c.videoId)} alt="Nouvelle miniature" loading="lazy" className="elev-1 aspect-video w-[120px] rounded-[10px] bg-muted object-cover" />
          </>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ytThumb(c.videoId)} alt="" loading="lazy" className="elev-1 aspect-video w-[160px] rounded-[10px] bg-muted object-cover" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          <KindBadge kind={c.kind} />
          <span className="font-medium text-foreground">{c.channel}</span>
          <span>· {formatCompact(c.subscribers)} abonnés</span>
          <span>· {relativeTime(c.at)}</span>
          {c.ageAtChangeDays !== null && <span>· publiée {formatNumber(c.ageAtChangeDays)} j avant le changement</span>}
          {extraMeta}
        </div>
        {c.kind === 'title_change' ? (
          <div className="flex flex-col gap-0.5">
            <p className="text-[15px] font-semibold leading-snug">{c.newValue ?? c.title}</p>
            {c.oldValue && <p className="text-[13px] leading-snug text-muted-foreground line-through">{c.oldValue}</p>}
          </div>
        ) : (
          <p className="text-[15px] font-semibold leading-snug">{c.title}</p>
        )}
        {topic && <p className="text-[13px] text-muted-foreground">sujet : {topic.label}</p>}
        <p className="text-[13px] text-muted-foreground">{paceText(c)}</p>
        <RowActions videoId={c.videoId} topic={topic} />
      </div>
      <VerdictBadge change={c} />
    </div>
  );
}
