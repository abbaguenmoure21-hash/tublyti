import { useState, useEffect, useCallback } from 'react';
import { parseYoutubeUrl, type YoutubePage } from '../../utils/youtube-url';
import { getSettings } from '../../utils/storage';
import type { LookupResult, MgiScoreData, OutlierData, FrustrationItem, CompetitorItem, ChannelVideoItem, SimilarChannel } from '../../utils/api';
import './style.css';

// ── Phase badge ───────────────────────────────────────────────────────

const PHASE_COLORS: Record<number, { bg: string; text: string; dot: string }> = {
  0: { bg: '#f1ebff', text: '#65389f', dot: '#8459c3' },
  1: { bg: '#fff0d7', text: '#8a4b00', dot: '#cf7c00' },
  2: { bg: '#d8f8e2', text: '#006337', dot: '#0e9254' },
  3: { bg: '#ffe8e8', text: '#a51c30', dot: '#d33949' },
};

function PhaseBadge({ phase, label }: { phase: number; label?: string }) {
  const c = PHASE_COLORS[phase];
  if (!c) return null;
  return (
    <span
      style={{ background: c.bg, color: c.text }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
    >
      <span style={{ background: c.dot }} className="w-1.5 h-1.5 rounded-full" />
      {label ?? `Phase ${phase}`}
    </span>
  );
}

// ── MGI score with band ───────────────────────────────────────────────

const MGI_BAND_COLORS: Record<string, string> = {
  low: '#e2e6ff',
  medium: '#b7c0f8',
  high: '#8c97e9',
  very_high: '#443cc6',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  low: 'Faible',
  medium: 'Moyenne',
  high: 'Haute',
};

function MgiScore({ data }: { data: MgiScoreData }) {
  const barColor = MGI_BAND_COLORS[data.band] ?? '#e2e6ff';
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">MGI</span>
        <span className="text-[10px] text-muted-foreground">
          {CONFIDENCE_LABELS[data.confidence]} · {data.freshness}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xl font-semibold tabular-nums">{data.value}</span>
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(data.value, 100)}%`, backgroundColor: barColor }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Outlier card ──────────────────────────────────────────────────────

function OutlierCard({ data }: { data: OutlierData }) {
  const isOutlier = data.ratio >= 2;
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">Score outlier</span>
        <span className="text-[10px] text-muted-foreground">{data.snapshotDate}</span>
      </div>
      <span className={`block text-lg font-semibold tabular-nums ${isOutlier ? 'text-phase-2' : 'text-foreground'}`}>
        {data.ratio}x
      </span>
      <p className="text-[11px] text-muted-foreground mt-0.5">{data.explanation}</p>
    </div>
  );
}

// ── Feasibility grade badge ───────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: '#0e9254', B: '#1a8a51', C: '#cf7c00', D: '#d6810c', E: '#d33949', F: '#d01c29',
};

function FeasibilityBadge({ grade, note }: { grade: string; note: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-sm font-semibold text-white"
        style={{ backgroundColor: GRADE_COLORS[grade] ?? '#5e636e' }}
      >
        {grade}
      </span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

// ── Sections ──────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mt-3 mb-1.5">{children}</h3>;
}

function FrustrationList({ items }: { items: FrustrationItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <SectionTitle>Frustrations</SectionTitle>
      <div className="space-y-1.5">
        {items.map((f, i) => (
          <div key={i} className="bg-card border border-border rounded-lg px-3 py-2">
            <p className="text-xs text-foreground leading-relaxed">{f.text}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{f.label}</span>
              {f.likeCount > 0 && (
                <span className="text-[10px] text-muted-foreground">{f.likeCount} likes</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompetitorList({ items }: { items: CompetitorItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <SectionTitle>Concurrents</SectionTitle>
      <div className="space-y-1.5">
        {items.map((c, i) => (
          <div key={i} className="bg-card border border-border rounded-lg px-3 py-2">
            <p className="text-xs font-medium text-foreground leading-snug">{c.title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground">{c.channelTitle}</span>
              {c.views != null && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {c.views.toLocaleString('fr-FR')} vues
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelVideoList({ items }: { items: ChannelVideoItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <SectionTitle>Dernieres videos</SectionTitle>
      <div className="space-y-1">
        {items.map((v) => (
          <a
            key={v.id}
            href={`https://www.youtube.com/watch?v=${v.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-card border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors"
          >
            <p className="text-xs font-medium text-foreground leading-snug truncate">{v.title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {v.views != null && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {v.views.toLocaleString('fr-FR')} vues
                </span>
              )}
              {v.outlierRatio != null && (
                <span className={`text-[10px] font-medium tabular-nums ${v.outlierRatio >= 2 ? 'text-phase-2' : 'text-muted-foreground'}`}>
                  {v.outlierRatio}x
                </span>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function SimilarChannelList({ items }: { items: SimilarChannel[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <SectionTitle>Chaines similaires</SectionTitle>
      <div className="space-y-1">
        {items.map((ch) => (
          <a
            key={ch.id}
            href={`https://www.youtube.com/channel/${ch.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors"
          >
            <span className="text-xs font-medium text-foreground truncate">{ch.title}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums ml-2 shrink-0">
              {ch.subscriberCount.toLocaleString('fr-FR')} abo.
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Shared UI elements ────────────────────────────────────────────────

function ActionButton({ label, onClick, primary, loading }: {
  label: string; onClick: () => void; primary?: boolean; loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
        primary ? 'bg-primary text-white hover:bg-primary-ink' : 'border border-border hover:bg-muted'
      }`}
    >
      {loading ? '...' : label}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-5 w-24 bg-muted rounded animate-pulse" />
        <div className="h-5 w-12 bg-muted rounded animate-pulse" />
      </div>
      <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
      <div className="h-16 bg-muted rounded-lg animate-pulse" />
      <div className="h-16 bg-muted rounded-lg animate-pulse" />
      <div className="space-y-1.5 mt-3">
        <div className="h-3 w-20 bg-muted rounded animate-pulse" />
        <div className="h-12 bg-muted rounded-lg animate-pulse" />
        <div className="h-12 bg-muted rounded-lg animate-pulse" />
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="p-4 text-center">
      <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-red-50 flex items-center justify-center">
        <span className="text-destructive text-sm font-bold">!</span>
      </div>
      <p className="text-sm text-foreground mb-1">{message}</p>
      <button onClick={onRetry} className="text-xs text-primary hover:underline cursor-pointer mt-2">
        Reessayer
      </button>
    </div>
  );
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('fr-FR');
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════

export default function App() {
  const [page, setPage] = useState<YoutubePage>({ type: 'unknown' });
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchData = useCallback(async (tabId: number) => {
    setLoading(true);
    setError(null);
    setActionMessage(null);
    try {
      const stored = await chrome.storage.session.get(`current_${tabId}`);
      const data = stored[`current_${tabId}`] as LookupResult | undefined;
      if (data) setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    init();
    const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.url) {
        const parsed = parseYoutubeUrl(changeInfo.url);
        setPage(parsed);
        if (parsed.type !== 'unknown') fetchData(tabId);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    return () => chrome.tabs.onUpdated.removeListener(listener);
  }, [fetchData]);

  async function init() {
    const settings = await getSettings();
    if (!settings.token) { setConfigured(false); setLoading(false); return; }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      setPage(parseYoutubeUrl(tab.url));
      if (tab.id) await fetchData(tab.id);
    } else {
      setLoading(false);
    }
  }

  async function handleAction(action: string, topicId: string) {
    setActionLoading(action);
    setActionMessage(null);
    const settings = await getSettings();
    try {
      const res = await fetch(`${settings.apiUrl}/api/ext/topic-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
        body: JSON.stringify({ action, topic_id: topicId }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; message?: string };
      if (res.ok) setActionMessage(data.message ?? 'OK');
      else setError(data.error ?? 'Erreur');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTrackChannel(channelId: string, nicheId: string) {
    setActionLoading('track');
    const settings = await getSettings();
    try {
      const res = await fetch(`${settings.apiUrl}/api/ext/track-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
        body: JSON.stringify({ channel_id: channelId, niche: nicheId }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; message?: string };
      if (res.ok) setActionMessage(data.message ?? 'Chaine ajoutee.');
      else setError(data.error ?? 'Erreur');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setActionLoading(null);
    }
  }

  function retry() {
    setError(null);
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) fetchData(tab.id);
    });
  }

  // ── States ─────────────────────────────────────────────────────────

  if (!configured) {
    return (
      <div className="p-4 text-center">
        <div className="text-lg font-semibold text-primary mb-2">TubLyTI</div>
        <p className="text-muted-foreground text-sm mb-3">Configure ton jeton API pour commencer.</p>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-ink"
        >
          Ouvrir les reglages
        </button>
      </div>
    );
  }

  if (page.type === 'unknown') {
    return (
      <div className="p-4 text-center">
        <div className="text-lg font-semibold text-primary mb-2">TubLyTI</div>
        <p className="text-muted-foreground text-sm mb-3">Navigue sur YouTube pour voir les opportunites.</p>
        <button
          onClick={() => getSettings().then((s) => window.open(`${s.apiUrl}/dashboard`, '_blank'))}
          className="text-xs text-primary hover:underline cursor-pointer"
        >
          Ouvrir TubLyTI
        </button>
      </div>
    );
  }

  if (loading) return <div className="flex flex-col h-full"><Header /><Skeleton /></div>;

  if (error && !result) return <div className="flex flex-col h-full"><Header /><ErrorState message={error} onRetry={retry} /></div>;

  return (
    <div className="flex flex-col h-full">
      <Header />

      {error && (
        <div className="px-4 py-2 bg-red-50 text-destructive text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-[10px] underline">Fermer</button>
        </div>
      )}
      {actionMessage && (
        <div className="px-4 py-2 bg-green-50 text-success text-xs flex items-center justify-between">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="ml-2 text-[10px] underline">Fermer</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* VIDEO — found */}
        {result?.type === 'video' && result.found && (
          <VideoView result={result} onAction={(a) => result.topicId && handleAction(a, result.topicId)} actionLoading={actionLoading} />
        )}

        {/* VIDEO — not found */}
        {result?.type === 'video' && !result.found && (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground mb-1">Video non rattachee a un sujet.</p>
            <p className="text-xs text-muted-foreground">TubLyTI ne suit pas encore cette video.</p>
          </div>
        )}

        {/* TRACKED CHANNEL */}
        {result?.type === 'channel' && result.found && <TrackedChannelView result={result} />}

        {/* UNKNOWN CHANNEL */}
        {result?.type === 'channel' && !result.found && (
          <UnknownChannelView result={result} channelId={page.type === 'channel' ? page.id : ''} onTrack={handleTrackChannel} actionLoading={actionLoading} />
        )}

        {/* SEARCH */}
        {result?.type === 'search' && <SearchView result={result} query={page.type === 'search' ? page.query : ''} />}
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────

function Header() {
  return (
    <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between shrink-0">
      <span className="text-sm font-semibold text-primary">TubLyTI</span>
      <button
        onClick={() => getSettings().then((s) => window.open(`${s.apiUrl}/dashboard`, '_blank'))}
        className="text-[11px] text-primary hover:underline cursor-pointer"
      >
        Ouvrir TubLyTI
      </button>
    </div>
  );
}

// ── Video view ────────────────────────────────────────────────────────

function VideoView({ result, onAction, actionLoading }: {
  result: LookupResult;
  onAction: (action: string) => void;
  actionLoading: string | null;
}) {
  const phase = result.phase as { phase: number; label: string } | null | undefined;

  return (
    <>
      {/* Phase + feasibility */}
      <div className="flex items-center justify-between">
        {phase && <PhaseBadge phase={phase.phase} label={phase.label} />}
        {result.feasibilityGrade && <FeasibilityBadge grade={result.feasibilityGrade} note={result.feasibilityNote ?? ''} />}
      </div>

      {/* Topic */}
      <h2 className="text-[15px] font-semibold leading-snug">{result.topicLabel}</h2>
      {result.nicheName && <p className="text-xs text-muted-foreground">{result.nicheName}</p>}

      {/* MGI */}
      {result.mgi && <MgiScore data={result.mgi as MgiScoreData} />}

      {/* Outlier */}
      {result.outlier && <OutlierCard data={result.outlier as OutlierData} />}

      {/* Frustrations */}
      {result.frustrations && result.frustrations.length > 0 && <FrustrationList items={result.frustrations as FrustrationItem[]} />}

      {/* Competitors */}
      {result.competitors && result.competitors.length > 0 && <CompetitorList items={result.competitors as CompetitorItem[]} />}

      {/* Actions */}
      {result.topicId && (
        <>
          <div className="flex flex-wrap gap-2 pt-1">
            <ActionButton label="Generer 5 angles" onClick={() => onAction('generate_angles')} primary loading={actionLoading === 'generate_angles'} />
            <ActionButton label="Sauver" onClick={() => onAction('save_favorite')} loading={actionLoading === 'save_favorite'} />
            <ActionButton label="En production" onClick={() => onAction('mark_production')} loading={actionLoading === 'mark_production'} />
          </div>
          <button
            onClick={() => getSettings().then((s) => window.open(`${s.apiUrl}/topics/${result.topicId}`, '_blank'))}
            className="w-full h-8 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
          >
            Ouvrir dans TubLyTI
          </button>
        </>
      )}
    </>
  );
}

// ── Tracked channel ───────────────────────────────────────────────────

function TrackedChannelView({ result }: { result: LookupResult }) {
  return (
    <>
      <h2 className="text-[15px] font-semibold">{result.channelTitle ?? 'Chaine'}</h2>
      {result.nicheName && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-primary-soft text-primary-ink">
          {result.nicheName}
        </span>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-card border border-border rounded-lg p-3">
          <span className="text-[10px] text-muted-foreground block">Abonnes</span>
          <span className="text-sm font-semibold tabular-nums">{fmtNum(result.subscriberCount)}</span>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <span className="text-[10px] text-muted-foreground block">Mediane vues</span>
          <span className="text-sm font-semibold tabular-nums">{fmtNum(result.medianViews)}</span>
        </div>
      </div>

      {result.publishingPace && <p className="text-xs text-muted-foreground">Rythme : {result.publishingPace}</p>}

      {result.recentVideos && <ChannelVideoList items={result.recentVideos as ChannelVideoItem[]} />}
      {result.similarChannels && <SimilarChannelList items={result.similarChannels as SimilarChannel[]} />}

      <p className="text-xs text-phase-2 font-medium mt-2">Chaine suivie</p>
    </>
  );
}

// ── Unknown channel ───────────────────────────────────────────────────

function UnknownChannelView({ result, channelId, onTrack, actionLoading }: {
  result: LookupResult;
  channelId: string;
  onTrack: (channelId: string, nicheId: string) => void;
  actionLoading: string | null;
}) {
  const [selectedNiche, setSelectedNiche] = useState('');
  const niches = (result.niches ?? []) as { id: string; name: string }[];

  return (
    <>
      <h2 className="text-[15px] font-semibold">{result.channelTitle ?? 'Chaine inconnue'}</h2>

      <div className="grid grid-cols-2 gap-2">
        {result.subscriberCount != null && (
          <div className="bg-card border border-border rounded-lg p-3">
            <span className="text-[10px] text-muted-foreground block">Abonnes</span>
            <span className="text-sm font-semibold tabular-nums">{fmtNum(result.subscriberCount)}</span>
          </div>
        )}
        {result.estimatedMedian != null && (
          <div className="bg-card border border-border rounded-lg p-3">
            <span className="text-[10px] text-muted-foreground block">Mediane estimee</span>
            <span className="text-sm font-semibold tabular-nums">{fmtNum(result.estimatedMedian)}</span>
          </div>
        )}
      </div>

      {result.subscriberCount == null && result.estimatedMedian == null && (
        <p className="text-xs text-muted-foreground">Aucune donnee disponible.</p>
      )}

      {niches.length > 0 && channelId && (
        <div className="space-y-2 pt-2">
          <select
            value={selectedNiche}
            onChange={(e) => setSelectedNiche(e.target.value)}
            className="w-full h-8 px-2 rounded-lg border border-border bg-card text-xs text-foreground"
          >
            <option value="">Choisir une niche...</option>
            {niches.map((n) => <option key={n.id} value={n.name}>{n.name}</option>)}
          </select>
          <div className="flex gap-2">
            <ActionButton label="Suivre cette chaine" onClick={() => selectedNiche && onTrack(channelId, selectedNiche)} primary loading={actionLoading === 'track'} />
            <ActionButton label="Ajouter aux candidates" onClick={() => onTrack(channelId, '_candidates')} loading={actionLoading === 'track'} />
          </div>
        </div>
      )}
    </>
  );
}

// ── Search ────────────────────────────────────────────────────────────

function SearchView({ result, query }: { result: LookupResult; query: string }) {
  const topics = result.topics ?? [];
  return (
    <>
      <h2 className="text-sm font-semibold text-muted-foreground">Recherche : {query}</h2>
      {topics.length > 0 ? (
        <div className="space-y-2">
          {topics.map((t) => (
            <div key={t.id} className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <PhaseBadge phase={t.phase} />
                <span className="text-sm font-semibold tabular-nums">{Math.round(t.mgi)}</span>
              </div>
              <p className="text-sm font-medium">{t.label}</p>
              {t.nicheName && <span className="text-[10px] text-muted-foreground">{t.nicheName}</span>}
              <button
                onClick={() => getSettings().then((s) => window.open(`${s.apiUrl}/topics/${t.id}`, '_blank'))}
                className="mt-1 text-xs text-primary hover:underline cursor-pointer block"
              >
                Voir dans TubLyTI
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-4">Aucun sujet correspondant.</p>
      )}
    </>
  );
}
