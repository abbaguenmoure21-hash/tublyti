import Link from 'next/link';
import { Tv } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { ScopePicker } from '@/components/app-shell/scope-picker';
import { geminiEnabled } from '@/lib/ai/gemini';
import { getCalibration, refreshAndFollow } from '@/lib/preflight/engine';
import { PreflightForm } from './_components/preflight-form';
import { FollowUp, History } from './_components/after-publish';

export const metadata = { title: 'Avant de publier' };
export const dynamic = 'force-dynamic';
// Les notes de miniature et de script passent par Gemini.
export const maxDuration = 300;

export default async function PreflightPage() {
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

  const { data: ch } = await db.from('user_channels').select('youtube_channel_id').eq('id', channelId).maybeSingle();
  const [{ follow, checks, linkable }, calibration] = await Promise.all([
    refreshAndFollow(db, user.id, channelId, (ch?.youtube_channel_id as string | null) ?? null),
    getCalibration(db, user.id, channelId),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">Avant de publier</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Note ton titre, ta miniature et ton script en les comparant aux vidéos qui ont sur-performé dans la niche de <strong className="font-medium text-foreground">{current.label}</strong>.
          Ce n’est pas une garantie : c’est une probabilité, qui se recale sur tes résultats réels à chaque vidéo publiée.
        </p>
      </header>

      <PreflightForm userChannelId={channelId} aiEnabled={geminiEnabled()} />

      <FollowUp rows={follow} />

      <History checks={checks} linkable={linkable} calibration={calibration} />
    </div>
  );
}
