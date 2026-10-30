import Link from 'next/link';
import { Tv } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { ScopePicker } from '@/components/app-shell/scope-picker';
import { geminiEnabled } from '@/lib/ai/gemini';
import { getCalibration, refreshAndFollow, type CheckRow, type FollowRow } from '@/lib/preflight/engine';
import { PreflightForm } from './_components/preflight-form';
import { FollowUp, History } from './_components/after-publish';
import { LinkSaturationCheck } from '@/components/tublyti/saturation';
import { KeywordCompare } from './_components/keyword-compare';

export const metadata = { title: 'Avant de publier' };
export const dynamic = 'force-dynamic';
// Thumbnail, script and video scoring go through the AI provider (long calls).
export const maxDuration = 300;

type View = 'evaluer' | 'idee' | 'resultats';
const VIEWS: { key: View; label: string }[] = [
  { key: 'evaluer', label: 'Évaluer ma vidéo' },
  { key: 'idee', label: 'Tester une idée' },
  { key: 'resultats', label: 'Après publication' },
];
const isView = (v: string | undefined): v is View => v === 'evaluer' || v === 'idee' || v === 'resultats';

function ViewPicker({ view }: { view: View }) {
  return (
    <nav aria-label="Outils avant et après publication" className="well inline-flex max-w-full self-start overflow-x-auto rounded-[10px] bg-background p-0.5">
      {VIEWS.map((v) => (
        <Link
          key={v.key}
          href={`/preflight?vue=${v.key}`}
          scroll={false}
          aria-current={v.key === view ? 'page' : undefined}
          className={`whitespace-nowrap rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors ${
            v.key === view ? 'elev-1 bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );
}

export default async function PreflightPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const sp = await searchParams;
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
        <p className="text-[15px] leading-relaxed text-muted-foreground">La note avant publication compare ta vidéo aux vidéos de ta niche : ajoute d’abord ta chaîne.</p>
        <Link href="/settings#chaines" className="mt-2 inline-flex h-11 items-center rounded-[10px] bg-primary px-5 text-[15px] font-medium text-primary-foreground hover:opacity-90">
          Ajouter ma chaîne
        </Link>
      </div>
    );
  }
  const current = scopeChannelId ? verified.find((c) => c.channelId === scopeChannelId) : verified.length === 1 ? verified[0] : null;
  if (!current) return <ScopePicker channels={verified.map((c) => ({ key: c.key, label: c.label, color: c.color }))} />;
  const channelId = current.channelId as string;

  // Follow-up data must never take the evaluation form down with it.
  let after: { follow: FollowRow[]; checks: CheckRow[]; linkable: { id: string; title: string }[]; calibration: Awaited<ReturnType<typeof getCalibration>> } | null = null;
  try {
    const { data: ch } = await db.from('user_channels').select('youtube_channel_id').eq('id', channelId).maybeSingle();
    const [{ follow, checks, linkable }, calibration] = await Promise.all([
      refreshAndFollow(db, user.id, channelId, (ch?.youtube_channel_id as string | null) ?? null),
      getCalibration(db, user.id, channelId),
    ]);
    after = { follow, checks, linkable, calibration };
  } catch (e) {
    console.error('[preflight] follow-up failed', e);
  }

  // Default view: the follow-up when a video under 72 h is below its usual views, otherwise the form.
  const needsAttention = after?.follow.some((r) => r.ageDays < 3 && r.status === 'below') ?? false;
  const view: View = isView(sp.vue) ? sp.vue : needsAttention ? 'resultats' : 'evaluer';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">Avant de publier</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Note ton titre, ta miniature et ton script en les comparant aux vidéos qui ont sur-performé dans la niche de <strong className="font-medium text-foreground">{current.label}</strong>.
          Ce n’est pas une garantie : c’est une probabilité, qui se recale sur tes résultats réels à chaque vidéo publiée.
        </p>
        <ViewPicker view={view} />
      </header>

      {/* The three views stay mounted (hidden when inactive): switching view must never abort a video
          upload or wipe what was typed. The URL only decides which one is visible. */}
      <div hidden={view !== 'evaluer'} className="flex flex-col gap-8">
        <PreflightForm userChannelId={channelId} aiEnabled={geminiEnabled()} />
      </div>

      <div hidden={view !== 'idee'} className="flex flex-col gap-8">
        <KeywordCompare userChannelId={channelId} />
        <LinkSaturationCheck />
      </div>

      <div hidden={view !== 'resultats'} className="flex flex-col gap-8">
        {after ? (
          <>
            <FollowUp rows={after.follow} />
            <History checks={after.checks} linkable={after.linkable} calibration={after.calibration} />
          </>
        ) : (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl bg-card px-4 py-8 text-center">
            <p className="text-[14px] text-muted-foreground">Impossible de charger tes résultats pour le moment.</p>
            <Link href="/preflight?vue=resultats" className="inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:opacity-90">
              Réessayer
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
