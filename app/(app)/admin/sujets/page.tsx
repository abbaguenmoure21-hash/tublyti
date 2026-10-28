import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { nicheColor } from '@/lib/scope';
import { proposedStatus, type ProposedStatus } from '@/lib/topics/auto-validate';
import { TriageDeck, type TriageCard } from './triage-deck';

export const metadata: Metadata = { title: 'Sujets à valider · Console' };

/** Console d'admin : les sujets proposés par la collecte, toutes niches confondues. */
export default async function AdminSujetsPage({ searchParams }: { searchParams: Promise<{ niche?: string; vue?: string }> }) {
  await requireAdmin();
  const { niche, vue } = await searchParams;
  const view: 'decider' | 'attente' = vue === 'attente' ? 'attente' : 'decider';
  const db = createServiceClient();

  const { data: nicheRows, error: nichesError } = await db.from('niches').select('id, name, category').order('name');
  if (nichesError) throw new Error(nichesError.message);
  const niches = (nicheRows ?? []) as { id: string; name: string; category: string | null }[];
  const nicheById = new Map(niches.map((n) => [n.id, n]));

  let proposedQ = db
    .from('topics')
    .select('id, label, niche_id, created_at, videos(id, title, channel_id, channels(title))')
    .eq('status', 'proposed')
    .order('created_at', { ascending: false })
    .limit(500);
  let activeQ = db.from('topics').select('id, label, niche_id').in('status', ['active', 'in_production']).order('label').limit(2000);
  if (niche) {
    proposedQ = proposedQ.eq('niche_id', niche);
    activeQ = activeQ.eq('niche_id', niche);
  }
  const [proposedRes, activeRes] = await Promise.all([proposedQ, activeQ]);
  // A failed read must not show « Aucun sujet à valider »: admin/error.tsx takes over.
  const readError = proposedRes.error ?? activeRes.error;
  if (readError) throw new Error(readError.message);

  type Row = {
    id: string;
    label: string;
    niche_id: string;
    videos: { id: string; title: string; channel_id: string; channels: { title: string } | null }[];
  };
  const all: TriageCard[] = ((proposedRes.data ?? []) as unknown as Row[]).map((t) => {
    const byChannel = new Map<string, number>();
    for (const v of t.videos) byChannel.set(v.channel_id, (byChannel.get(v.channel_id) ?? 0) + 1);
    const topShare = t.videos.length ? Math.max(...byChannel.values()) / t.videos.length : 0;
    const n = nicheById.get(t.niche_id);
    const st = proposedStatus(t.label, t.videos.map((v) => v.channel_id));
    return {
      id: t.id,
      label: t.label,
      nicheId: t.niche_id,
      nicheLabel: n?.name ?? '',
      nicheColor: nicheColor(n?.category),
      videoCount: t.videos.length,
      channelCount: byChannel.size,
      dominantShare: Math.round(topShare * 100),
      sampleTitles: t.videos.slice(0, 3).map((v) => ({ title: v.title, channel: v.channels?.title ?? '' })),
      sensitive: st.status === 'sensitive',
      status: st.status,
      statusReason: st.reason,
    };
  });

  // « À décider » : ce que le robot ne tranchera jamais seul (sujets sensibles).
  // « En attente » : le robot les publie dès 5 vidéos de 3 chaînes ; tu peux trier en avance.
  const order: Record<ProposedStatus, number> = { sensitive: 0, ready: 1, waiting: 2 };
  const counts = {
    decide: all.filter((c) => c.status === 'sensitive').length,
    waiting: all.filter((c) => c.status !== 'sensitive').length,
    ready: all.filter((c) => c.status === 'ready').length,
  };
  const cards = all
    .filter((c) => (view === 'decider' ? c.status === 'sensitive' : c.status !== 'sensitive'))
    .sort((a, b) => order[a.status] - order[b.status] || b.videoCount - a.videoCount);

  const mergeTargets = ((activeRes.data ?? []) as { id: string; label: string; niche_id: string }[]).map((t) => ({
    id: t.id,
    label: t.label,
    nicheId: t.niche_id,
  }));

  if (all.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-24 text-center">
        <CheckCircle2 className="h-10 w-10 text-phase-2" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Aucun sujet à valider</h1>
        <p className="text-[15px] text-muted-foreground">Les prochains sujets proposés arriveront après la collecte de cette nuit.</p>
        <Link href="/admin" className="mt-2 inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground">
          Revenir à la console
        </Link>
      </div>
    );
  }

  return <TriageDeck key={view} cards={cards} mergeTargets={mergeTargets} view={view} counts={counts} />;
}
