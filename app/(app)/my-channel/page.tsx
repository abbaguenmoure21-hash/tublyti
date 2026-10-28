import { Suspense } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { ScopePicker } from '@/components/app-shell/scope-picker';
import { googleEnabled } from '@/lib/youtube/google-oauth';
import { encryptionReady } from '@/lib/crypto/tokens';
import { getChannelAnalytics, PERIODS, type AnalyticsData, type Period } from '@/lib/youtube/analytics';
import { getPublicStats, type PublicStats, type PublicVideo } from '@/lib/youtube/public-stats';
import { AnalyticsControls, DailyChart, MonthlyChart, RefreshPublicButton } from './_components/channel-charts';
import { TopVideos } from './_components/top-videos';
import { AnalyzeVideoButton } from '@/components/tublyti/video-analysis';
import { BarChart3, ExternalLink, Lock, Tv } from 'lucide-react';

export const metadata = { title: 'Ma chaîne' };
// L'analyse vidéo (Gemini) peut prendre jusqu'à 2-3 minutes.
export const maxDuration = 300;

const nf = new Intl.NumberFormat('fr-FR');
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct = (v: number, d = 1) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: d })} %`;
const regions = new Intl.DisplayNames(['fr'], { type: 'region' });

function duration(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m} min ${String(r).padStart(2, '0')}` : `${r} s`;
}
function hours(minutes: number) {
  return `${compact.format(minutes / 60)} h`;
}
function ago(iso: string | null) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'aujourd’hui' : d === 1 ? 'hier' : `il y a ${d} j`;
}

const TRAFFIC: Record<string, string> = {
  YT_SEARCH: 'Recherche YouTube',
  SUBSCRIBER: 'Abonnements et accueil',
  RELATED_VIDEO: 'Vidéos suggérées',
  YT_CHANNEL: 'Pages de la chaîne',
  EXT_URL: 'Sites externes',
  NO_LINK_OTHER: 'Accès direct',
  PLAYLIST: 'Playlists',
  YT_OTHER_PAGE: 'Autres pages YouTube',
  NOTIFICATION: 'Notifications',
  SHORTS: 'Flux Shorts',
  END_SCREEN: 'Écrans de fin',
  ANNOTATION: 'Fiches et annotations',
  CAMPAIGN_CARD: 'Fiches de campagne',
  HASHTAGS: 'Hashtags',
  YT_PLAYLIST_PAGE: 'Pages de playlist',
  ADVERTISING: 'Publicité YouTube',
  SOUND_PAGE: 'Pages de son',
  LIVE_REDIRECT: 'Redirection de live',
  PRODUCT_PAGE: 'Pages produit',
  VIDEO_REMIXES: 'Remix',
  IMMERSIVE_LIVE: 'Live immersif',
};
const DEVICES: Record<string, string> = {
  MOBILE: 'Téléphone',
  DESKTOP: 'Ordinateur',
  TV: 'Télévision',
  TABLET: 'Tablette',
  GAME_CONSOLE: 'Console de jeu',
  UNKNOWN_PLATFORM: 'Autre',
};

const STATUS: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
  ok: { tone: 'ok', text: 'YouTube Analytics est connecté. Tes statistiques privées et tes revenus s’affichent ci-dessous.' },
  'ok-sans-revenus': { tone: 'ok', text: 'YouTube Analytics est connecté, sans l’accès aux revenus. Reconnecte et coche « revenus » pour les voir.' },
  'autre-chaine': { tone: 'warn', text: 'Le compte Google choisi ne gère pas cette chaîne. Reconnecte-toi avec le compte propriétaire.' },
  erreur: { tone: 'warn', text: 'La connexion à YouTube Analytics n’a pas abouti. Réessaie.' },
  migration: { tone: 'warn', text: 'Il manque la migration 00023 dans Supabase pour enregistrer l’accès.' },
  indisponible: { tone: 'warn', text: 'La connexion Google n’est pas encore configurée sur TubLyTI.' },
};

/* ---------- petits composants ---------- */

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-card p-4">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[22px] font-semibold leading-tight tracking-[-0.01em] tabular-nums">{value}</span>
      {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Section({ id, title, subtitle, action, children }: { id: string; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id={id} className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Panel({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 md:p-5">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children}
      {note && <p className="text-xs leading-snug text-muted-foreground">{note}</p>}
    </div>
  );
}

function BarList({ rows }: { rows: { label: string; value: number }[] }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-muted-foreground">Pas encore de données sur cette période.</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1" title={`${r.label} : ${nf.format(r.value)} vues`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{total ? pct((r.value / total) * 100, 0) : '—'}</span>
          </div>
          <div className="well h-2 overflow-hidden rounded-full bg-background">
            <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Segmented({ period }: { period: Period }) {
  return (
    <nav aria-label="Période" className="well inline-flex rounded-[10px] bg-background p-0.5">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={`/my-channel?periode=${p.key}`}
          scroll={false}
          aria-current={p.key === period ? 'page' : undefined}
          className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors ${
            p.key === period ? 'elev-1 bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

function VideoRow({ v, rank, channelId }: { v: PublicVideo; rank?: number; channelId?: string }) {
  return (
    <li className="flex items-center gap-3 border-b border-muted px-4 py-3 last:border-b-0">
      {rank !== undefined && <span className="w-5 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{rank}</span>}
      {v.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.thumbnailUrl} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="h-11 w-[78px] shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="h-11 w-[78px] shrink-0 rounded-lg bg-muted" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="truncate text-sm font-medium hover:underline">
          {v.title}
        </a>
        <span className="text-xs text-muted-foreground">
          {v.isShort ? 'Short' : duration(v.durationS)} · {ago(v.publishedAt)} · {nf.format(v.likes)} j’aime · {nf.format(v.comments)} commentaires
        </span>
      </div>
      <AnalyzeVideoButton videoId={v.id} title={v.title} channelId={channelId} variant="icon" />
      <div className="flex shrink-0 flex-col items-end">
        <span className="text-sm font-semibold tabular-nums">{compact.format(v.views)}</span>
        {v.ratio !== null && (
          <span className={`text-xs tabular-nums ${v.ratio >= 1.5 ? 'text-primary' : 'text-muted-foreground'}`}>
            ×{v.ratio.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} {v.isShort ? 'tes Shorts' : 'ta médiane'}
          </span>
        )}
      </div>
    </li>
  );
}

/* ---------- sections ---------- */

function AnalyticsBlock({ data, hasMonetary, channelId, reach, reachNote }: { data: AnalyticsData; hasMonetary: boolean; channelId: string; reach: Map<string, { impressions: number; ctr: number | null }>; reachNote: string | null }) {
  const t = data.totals;
  const subsNet = t.subscribersGained - t.subscribersLost;
  const engagement = t.views ? ((t.likes + t.comments + t.shares) / t.views) * 100 : 0;
  const subTotal = data.subscribed.subscribed + data.subscribed.notSubscribed;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Vues" value={compact.format(t.views)} hint={t.views >= 10_000 ? nf.format(t.views) : undefined} />
        <Tile label="Durée regardée" value={hours(t.minutesWatched)} hint={`${nf.format(Math.round(t.minutesWatched / 60))} heures`} />
        <Tile label="Durée moyenne" value={duration(t.averageViewDuration)} hint={`${pct(t.averageViewPercentage)} de la vidéo regardée`} />
        <Tile label="Abonnés" value={`${subsNet >= 0 ? '+' : ''}${nf.format(subsNet)}`} hint={`+${nf.format(t.subscribersGained)} gagnés · −${nf.format(t.subscribersLost)} perdus`} />
        <Tile label="Interactions" value={pct(engagement, 2)} hint={`${compact.format(t.likes)} j’aime · ${compact.format(t.comments)} comm. · ${compact.format(t.shares)} partages`} />
        <Tile label="Vues d’abonnés" value={subTotal ? pct((data.subscribed.subscribed / subTotal) * 100, 0) : '—'} hint="Le reste vient de nouveaux spectateurs" />
      </div>

      <Panel title="Vues par jour">
        <DailyChart data={data.daily} metric="views" label="Vues par jour sur la période" />
      </Panel>

      <div className="flex flex-col gap-3">
        <h3 className="text-[17px] font-semibold">Revenus</h3>
        {data.revenue ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Tile label="Revenus estimés" value={usd.format(data.revenue.estimatedRevenue)} hint="Ta part, après celle de YouTube" />
              <Tile label="RPM" value={usd.format(data.revenue.rpm)} hint="Revenu pour 1 000 vues" />
              <Tile label="CPM" value={usd.format(data.revenue.cpm)} hint="Prix payé par les annonceurs pour 1 000 affichages" />
              <Tile label="Revenus publicitaires" value={usd.format(data.revenue.adRevenue)} hint={`Brut : ${usd0.format(data.revenue.grossRevenue)}`} />
              <Tile label="Lectures monétisées" value={compact.format(data.revenue.monetizedPlaybacks)} hint={t.views ? `${pct((data.revenue.monetizedPlaybacks / t.views) * 100, 0)} des vues` : undefined} />
              <Tile label="Affichages de pubs" value={compact.format(data.revenue.adImpressions)} hint={`CPM par lecture : ${usd.format(data.revenue.playbackBasedCpm)}`} />
            </div>
            <Panel title="Revenus estimés par jour" note="Montants en dollars US, tels que calculés par YouTube. Ils peuvent changer pendant quelques jours avant d’être définitifs.">
              <DailyChart data={data.daily} metric="revenue" label="Revenus estimés par jour" />
            </Panel>
          </>
        ) : (
          <p className="rounded-2xl border border-dashed border-border px-5 py-6 text-sm leading-relaxed text-muted-foreground">
            {data.revenueNote ?? 'Revenus indisponibles.'}
            {!hasMonetary && ' Les revenus n’apparaissent que si la chaîne fait partie du Programme Partenaire YouTube.'}
          </p>
        )}
      </div>

      <Panel title="Abonnés gagnés moins perdus, par jour">
        <DailyChart data={data.daily} metric="subsNet" label="Abonnés nets par jour" />
      </Panel>

      <div className="overflow-hidden rounded-2xl bg-card">
        <h3 className="border-b border-border px-4 py-3 text-[15px] font-semibold">Meilleures vidéos sur la période <span className="font-normal text-muted-foreground">· clique sur « Rétention » pour voir où les spectateurs décrochent · impressions et CTR depuis le début des rapports YouTube (30 jours avant la connexion)</span></h3>
        {reachNote && <p className="border-b border-muted bg-muted/40 px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">{reachNote}</p>}
        {data.topVideos.length ? (
          <TopVideos channelId={channelId} rows={data.topVideos.map((v) => ({ ...v, impressions: reach.get(v.id)?.impressions ?? null, ctr: reach.get(v.id)?.ctr ?? null }))} hasRevenue={Boolean(data.revenue)} />
        ) : (
          <p className="px-4 py-6 text-sm text-muted-foreground">Aucune vue sur cette période.</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="D’où viennent les vues">
          <BarList rows={data.traffic.slice(0, 8).map((r) => ({ label: TRAFFIC[r.key] ?? r.key, value: r.views }))} />
        </Panel>
        <Panel title="Pays">
          <BarList
            rows={data.countries.slice(0, 8).map((r) => {
              let label = r.key;
              try { label = regions.of(r.key) ?? r.key; } catch { /* code inconnu */ }
              return { label, value: r.views };
            })}
          />
        </Panel>
        <Panel title="Appareils">
          <BarList rows={data.devices.map((r) => ({ label: DEVICES[r.key] ?? r.key, value: r.views }))} />
        </Panel>
      </div>

      <Panel title="Âge et genre du public" note="Part des spectateurs connectés à leur compte Google. YouTube masque ces chiffres quand le public est trop petit.">
        {data.demographics.length ? (
          <>
            <div className="flex flex-wrap gap-4 text-[13px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--chart-1)]" aria-hidden="true" />Hommes</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--chart-3)]" aria-hidden="true" />Femmes</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[var(--chart-4)]" aria-hidden="true" />Autre</span>
            </div>
            <ul className="flex flex-col gap-2.5">
              {data.demographics.map((d) => {
                const total = d.male + d.female + d.other;
                return (
                  <li key={d.age} className="grid grid-cols-[64px_1fr_52px] items-center gap-3 text-sm" title={`${d.age} ans : hommes ${pct(d.male)}, femmes ${pct(d.female)}, autre ${pct(d.other)}`}>
                    <span className="tabular-nums">{d.age}</span>
                    <div className="well flex h-3 overflow-hidden rounded-full bg-background">
                      <div className="h-full bg-[var(--chart-1)]" style={{ width: `${d.male}%` }} />
                      <div className="h-full border-l-2 border-card bg-[var(--chart-3)]" style={{ width: `${d.female}%` }} />
                      {d.other > 0 && <div className="h-full border-l-2 border-card bg-[var(--chart-4)]" style={{ width: `${d.other}%` }} />}
                    </div>
                    <span className="text-right tabular-nums text-muted-foreground">{pct(total, 0)}</span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Pas assez de spectateurs pour que YouTube communique ces chiffres.</p>
        )}
      </Panel>
    </div>
  );
}

function PublicBlock({ s, linked, channelId }: { s: PublicStats; linked: boolean; channelId?: string }) {
  return (
    <div className="flex flex-col gap-4">
      {s.sample === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-5 py-6 text-sm leading-relaxed text-muted-foreground">
          {linked ? (
            'Les vidéos de ta chaîne n’ont pas encore été lues. Clique sur « Mettre à jour » en haut de la page pour importer tes 50 dernières vidéos.'
          ) : (
            <>
              Cette chaîne n’est pas encore reliée à YouTube.{' '}
              <Link href="/settings#chaines" className="font-medium text-primary">Ajoute son adresse YouTube dans Réglages</Link> pour voir ses chiffres.
            </>
          )}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Vues habituelles" value={compact.format(s.medianViews)} hint={`Médiane des vidéos longues · moyenne ${compact.format(Math.round(s.averageViews))}`} />
            <Tile label="Interactions" value={pct(s.engagementRate, 2)} hint={`${pct(s.likeRate, 2)} j’aime · ${pct(s.commentRate, 2)} commentaires`} />
            <Tile label="Rythme" value={`${s.uploadsPerWeek.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} / sem.`} hint={s.daysSinceLast === null ? undefined : `Dernière vidéo ${s.daysSinceLast === 0 ? 'aujourd’hui' : `il y a ${s.daysSinceLast} j`}`} />
            <Tile label="Meilleur jour" value={s.bestWeekday ? s.bestWeekday.day : '—'} hint={s.bestWeekday ? `${compact.format(s.bestWeekday.median)} vues habituelles` : 'Pas encore assez de vidéos'} />
            <Tile label="Vidéos longues" value={compact.format(s.long.median)} hint={`${s.long.count} vidéos · vues habituelles`} />
            <Tile label="Shorts" value={s.shorts.count ? compact.format(s.shorts.median) : '—'} hint={`${s.shorts.count} Shorts · vues habituelles`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Panel title="Vues par mois de publication" note="Vues actuelles des vidéos, regroupées selon leur mois de mise en ligne.">
              {s.monthly.length ? <MonthlyChart data={s.monthly} /> : <p className="text-sm text-muted-foreground">Pas de vidéo sur les 12 derniers mois.</p>}
            </Panel>
            <Panel
              title="Revenus estimés"
              note={
                s.estimate
                  ? `Estimation TubLyTI : vues des vidéos longues × RPM habituel de la thématique (${usd.format(s.estimate.rpmLow)} à ${usd.format(s.estimate.rpmHigh)} pour 1 000 vues${s.estimate.source ? `, source : ${s.estimate.source}` : ''}). Seuls les vrais chiffres de YouTube Analytics font foi.`
                  : undefined
              }
            >
              {s.estimate ? (
                <div className="flex flex-col gap-1">
                  <span className="text-[26px] font-semibold tracking-[-0.01em] tabular-nums">
                    {usd0.format(s.estimate.low)} – {usd0.format(s.estimate.high)}
                  </span>
                  <span className="text-sm text-muted-foreground">pour {compact.format(s.estimate.views)} vues sur les {s.long.count} vidéos longues lues</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">La fourchette de RPM de ta thématique n’est pas encore renseignée.</p>
              )}
            </Panel>
          </div>

          <Panel title="Vues habituelles selon le jour de publication" note="Vidéos longues publiées il y a plus de 7 jours. Jour en heure UTC.">
            <ul className="grid grid-cols-7 gap-2">
              {s.weekdays.map((w) => {
                const max = Math.max(1, ...s.weekdays.map((x) => x.median));
                return (
                  <li key={w.day} className="flex flex-col items-center gap-1.5" title={`${w.day} : ${w.videos} vidéos, ${nf.format(Math.round(w.median))} vues habituelles`}>
                    <div className="well flex h-24 w-full items-end overflow-hidden rounded-lg bg-background">
                      <div className="w-full rounded-t-[4px] bg-[var(--chart-1)]" style={{ height: `${(w.median / max) * 100}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{w.day.slice(0, 3)}.</span>
                    <span className="text-xs tabular-nums">{w.videos ? compact.format(w.median) : '—'}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {s.outliers.length > 0 && (
            <div className="overflow-hidden rounded-2xl bg-card">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-[15px] font-semibold">Tes vidéos qui ont décollé</h3>
                <p className="text-xs text-muted-foreground">Au moins deux fois tes vues habituelles pour ce format : refais des sujets proches.</p>
              </div>
              <ul>{s.outliers.map((v) => <VideoRow key={v.id} v={v} channelId={channelId} />)}</ul>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl bg-card">
            <h3 className="border-b border-border px-4 py-3 text-[15px] font-semibold">Dernières vidéos</h3>
            <ul>{s.recent.map((v, i) => <VideoRow key={v.id} v={v} rank={i + 1} channelId={channelId} />)}</ul>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- page ---------- */

export default async function MyChannelPage({ searchParams }: { searchParams: Promise<{ periode?: string; analytics?: string }> }) {
  const sp = await searchParams;
  const period: Period = (PERIODS.find((p) => p.key === sp.periode)?.key ?? '28') as Period;
  const user = await requireUser();
  const db = createServiceClient();

  const { allChannels, scopeChannelId } = await resolveScope(db, user.id);
  const verified = allChannels.filter((c) => c.kind === 'channel' && c.verified && c.channelId);

  if (!verified.length) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-ink">
          <Tv className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Aucune chaîne vérifiée</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">Ajoute ta chaîne et vérifie qu’elle t’appartient : ses statistiques et ses revenus s’afficheront ici.</p>
        <Link href="/settings#chaines" className="mt-2 inline-flex h-11 items-center rounded-[10px] bg-primary px-5 text-[15px] font-medium text-primary-foreground hover:opacity-90">
          Ajouter ma chaîne
        </Link>
      </div>
    );
  }

  const current = scopeChannelId ? verified.find((c) => c.channelId === scopeChannelId) : verified.length === 1 ? verified[0] : null;
  if (!current) {
    return <ScopePicker channels={verified.map((c) => ({ key: c.key, label: c.label, color: c.color }))} />;
  }
  const channelId = current.channelId as string;

  // Only the public stats (read from our DB) block the first byte. YouTube Analytics (live API calls
  // when its cache is stale) streams in below, inside its own Suspense boundary.
  const stats = await getPublicStats(db, channelId);
  if (!stats) return null;
  const c = stats.channel;
  const status = sp.analytics ? STATUS[sp.analytics] : null;
  const canConnect = googleEnabled() && encryptionReady();

  return (
    <div className="flex min-h-full flex-1 flex-col gap-8 px-4 pb-16 pt-5 md:px-8">
      <header className="flex flex-wrap items-center gap-4">
        {c.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="elev-1 h-16 w-16 rounded-full object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-primary-ink"><Tv className="h-7 w-7" aria-hidden="true" /></span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">{c.title}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-muted-foreground">
            {c.handle && <span>{c.handle}</span>}
            {c.nicheName && <span>{c.nicheName}</span>}
            {c.youtubeId.startsWith('UC') && (
              <a href={`https://www.youtube.com/channel/${c.youtubeId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">
                Voir sur YouTube <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
          </p>
        </div>
        {c.youtubeId.startsWith('UC') && <RefreshPublicButton id={channelId} />}
      </header>

      <div className="grid grid-cols-3 gap-3 md:max-w-2xl">
        <Tile label="Abonnés" value={c.subscribers === null ? (c.checkedAt ? 'Masqués' : '—') : compact.format(c.subscribers)} hint={c.subscribers === null || c.subscribers < 10_000 ? undefined : nf.format(c.subscribers)} />
        <Tile label="Vues totales" value={c.totalViews === null ? '—' : compact.format(c.totalViews)} hint={c.totalViews === null || c.totalViews < 10_000 ? undefined : nf.format(c.totalViews)} />
        <Tile label="Vidéos" value={c.videoCount === null ? '—' : nf.format(c.videoCount)} hint={c.checkedAt ? `Mis à jour ${ago(c.checkedAt)}` : undefined} />
      </div>

      {status && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${status.tone === 'ok' ? 'bg-primary-soft text-primary-ink' : 'bg-[color-mix(in_oklch,var(--warning)_14%,transparent)]'}`}>
          {status.text}
        </p>
      )}

      <Suspense key={period} fallback={<AnalyticsSkeleton />}>
        <AnalyticsSection channelId={channelId} period={period} canConnect={canConnect} linked={c.youtubeId.startsWith('UC')} />
      </Suspense>

      <Section id="public-titre" title="Chiffres publics" subtitle={stats.sample ? `Calculés par TubLyTI sur tes ${stats.sample} dernières vidéos lues, sans accès à ton compte.` : 'Calculés par TubLyTI à partir de tes vidéos publiques, sans accès à ton compte.'}>
        <PublicBlock s={stats} linked={c.youtubeId.startsWith('UC')} channelId={channelId} />
      </Section>
    </div>
  );
}

/** Placeholder shown while YouTube Analytics answers (same section title, reserved height). */
function AnalyticsSkeleton() {
  return (
    <Section id="analytics-titre" title="Statistiques YouTube Analytics" subtitle="Les chiffres privés de YouTube Studio : durée de visionnage, revenus, public.">
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Chargement des statistiques YouTube Analytics">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </Section>
  );
}

/** YouTube Analytics block: may call the live API (cache stale), so it is streamed under Suspense. */
async function AnalyticsSection({ channelId, period, canConnect, linked }: { channelId: string; period: Period; canConnect: boolean; linked: boolean }) {
  const db = createServiceClient();
  const analytics = await getChannelAnalytics(db, channelId, period);
  // Impressions et CTR des miniatures (rapports quotidiens YouTube, depuis la connexion + 30 jours d'historique).
  const reach = new Map<string, { impressions: number; ctr: number | null }>();
  if (analytics.status === 'ok' && analytics.data.topVideos.length) {
    const { data: rows } = await db
      .from('video_reach_daily')
      .select('video_id, impressions, ctr')
      .eq('user_channel_id', channelId)
      .in('video_id', analytics.data.topVideos.map((v) => v.id))
      .limit(5000);
    const acc = new Map<string, { imp: number; clicks: number }>();
    for (const r of (rows ?? []) as { video_id: string; impressions: number; ctr: number | null }[]) {
      const cur = acc.get(r.video_id) ?? { imp: 0, clicks: 0 };
      cur.imp += Number(r.impressions);
      cur.clicks += Number(r.impressions) * Number(r.ctr ?? 0);
      acc.set(r.video_id, cur);
    }
    for (const [k, v] of acc) reach.set(k, { impressions: v.imp, ctr: v.imp ? v.clicks / v.imp : null });
  }
  // Où en est le rapport quotidien des miniatures (affiché tant qu'aucun chiffre n'est arrivé).
  let reachNote: string | null = null;
  if (analytics.status === 'ok' && reach.size === 0) {
    const { data: job, error: jobErr } = await db.from('reporting_jobs').select('created_at, last_sync_at, last_error').eq('user_channel_id', channelId).maybeSingle();
    if (jobErr) reachNote = 'Impressions et CTR : il manque la migration 00027 dans Supabase.';
    else if (!job) reachNote = 'Impressions et CTR : la demande de rapport n’a pas été enregistrée. Clique sur « Déconnecter » puis reconnecte YouTube Analytics.';
    else if (job.last_error) reachNote = `Impressions et CTR : YouTube a répondu une erreur (${String(job.last_error).slice(0, 140)}).`;
    else {
      const ready = new Date(new Date(job.created_at as string).getTime() + 48 * 3_600_000);
      reachNote = `Impressions et CTR : demande envoyée à YouTube le ${new Date(job.created_at as string).toLocaleDateString('fr-FR')}. YouTube livre le premier rapport d’ici le ${ready.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} (avec les 30 jours précédents) ; il est importé la nuit suivante.`;
    }
  }
  return (
    <Section
        id="analytics-titre"
        title="Statistiques YouTube Analytics"
        subtitle={
          analytics.status === 'ok'
            ? `Du ${new Date(analytics.data.startDate).toLocaleDateString('fr-FR')} au ${new Date(analytics.data.endDate).toLocaleDateString('fr-FR')} · chiffres officiels de YouTube, consolidés avec 2 jours de retard`
            : 'Les chiffres privés de YouTube Studio : durée de visionnage, revenus, public.'
        }
        action={
          analytics.status === 'ok' ? (
            <div className="flex flex-wrap items-center gap-3">
              <Segmented period={period} />
              <AnalyticsControls id={channelId} period={period} />
            </div>
          ) : undefined
        }
      >
        {analytics.status === 'ok' ? (
          <AnalyticsBlock data={analytics.data} hasMonetary={analytics.hasMonetary} channelId={channelId} reach={reach} reachNote={reachNote} />
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-2xl bg-card p-5 md:flex-row md:items-center">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-ink">
              {analytics.status === 'erreur' ? <Lock className="h-5 w-5" aria-hidden="true" /> : <BarChart3 className="h-5 w-5" aria-hidden="true" />}
            </span>
            <div className="flex flex-1 flex-col gap-1">
              <p className="text-[15px] font-medium">
                {analytics.status === 'erreur'
                  ? analytics.reason === 'acces-retire'
                    ? 'L’accès à YouTube Analytics a été retiré'
                    : 'YouTube Analytics ne répond pas pour le moment'
                  : 'Connecte YouTube Analytics pour tout voir'}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Durée de visionnage, abonnés gagnés et perdus, sources de trafic, pays, âge du public et, si ta chaîne est monétisée, tes revenus, RPM et CPM réels. Lecture seule : TubLyTI ne peut rien modifier sur ta chaîne, et tu peux retirer l’accès à tout moment.
              </p>
            </div>
            {canConnect && linked ? (
              <a
                href={`/api/youtube/connect?mode=analytics&chaine=${channelId}`}
                className="inline-flex h-11 shrink-0 items-center rounded-[10px] bg-primary px-5 text-[15px] font-medium text-primary-foreground hover:opacity-90"
              >
                {analytics.status === 'erreur' ? 'Reconnecter' : 'Connecter YouTube Analytics'}
              </a>
            ) : (
              <p className="shrink-0 text-sm text-muted-foreground">{canConnect ? 'Relie d’abord la chaîne à YouTube' : 'Bientôt disponible'}</p>
            )}
          </div>
        )}
    </Section>
  );
}
