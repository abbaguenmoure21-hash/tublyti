import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { AppToaster } from '@/components/app-toaster';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar } from '@/components/app-shell/sidebar';
import { SIDEBAR_COOKIE } from '@/components/app-shell/nav-config';
import { ScopeGate } from '@/components/app-shell/scope-gate';
import { MobileScope } from '@/components/app-shell/mobile-scope';
import { SectionTabs } from '@/components/app-shell/section-tabs';
import { MobileTabBar } from '@/components/mobile-tab-bar';
import { KeyboardProvider } from '@/components/keyboard-provider';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser, isDbReady } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';

async function getShellData(userId: string, ready: boolean) {
  const db = createServiceClient();
  try {
    let videosQ = db.from('angles').select('id, topics!inner(niche_id)').in('status', ['idea', 'in_production']).limit(500);
    if (ready) videosQ = videosQ.eq('user_id', userId);
    const [{ scopeKey: scope, allChannels: niches, pendingChannel, nicheIds, scopeChannelId }, inProgress, lastScore] = await Promise.all([
      resolveScope(db, userId),
      videosQ,
      db.from('jobs').select('finished_at').eq('kind', 'score').not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1),
    ]);
    const last = lastScore.data?.[0]?.finished_at as string | undefined;
    const dataFresh = last ? Date.now() - new Date(last).getTime() < 36 * 3_600_000 : false;
    // Pastille « Mes vidéos » : uniquement les vidéos de la chaîne affichée.
    let videos = ((inProgress.data ?? []) as unknown as { id: string; topics: { niche_id: string } }[]).filter((v) =>
      nicheIds.includes(v.topics.niche_id),
    );
    if (scopeChannelId && videos.length) {
      const { data: links, error } = await db.from('angles').select('id, user_channel_id').in('id', videos.map((v) => v.id));
      if (!error) {
        const ch = new Map(((links ?? []) as { id: string; user_channel_id: string | null }[]).map((l) => [l.id, l.user_channel_id]));
        videos = videos.filter((v) => !ch.get(v.id) || ch.get(v.id) === scopeChannelId);
      }
    }
    const pending = pendingChannel?.channelId ? { channelId: pendingChannel.channelId, label: pendingChannel.label } : null;
    return { niches, scope, pending, badges: { videos: videos.length }, dataFresh };
  } catch (e) {
    console.error('[layout] shell data failed', e instanceof Error ? e.message : e);
    return { niches: [], scope: null, pending: null, badges: {}, dataFresh: false };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const ready = await isDbReady();
  const [shell, store] = await Promise.all([getShellData(user.id, ready), cookies()]);
  const sidebarCollapsed = store.get(SIDEBAR_COOKIE)?.value === 'collapsed';

  return (
    <NuqsAdapter>
      <TooltipProvider delay={300}>
        <a
          href="#contenu-principal"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
        >
          Aller au contenu
        </a>
        <div className="flex min-h-screen bg-background">
          <Sidebar
            niches={shell.niches}
            scope={shell.scope}
            badges={shell.badges}
            dataFresh={shell.dataFresh}
            userLabel={user.displayName}
            isAdmin={user.role === 'admin'}
            initialCollapsed={sidebarCollapsed}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            {!ready && (
              <p role="status" className="mx-4 mt-4 rounded-2xl bg-warning-soft px-4 py-3 text-[13px] text-warning-ink shadow-sm md:mx-8">
                Mise à jour de la base à faire : exécute la migration <strong>00018_clients_et_roles.sql</strong> dans Supabase pour activer
                les comptes clients. En attendant, l’app fonctionne comme avant.
              </p>
            )}
            <MobileScope channels={shell.niches.map((n) => ({ key: n.key, label: n.label, verified: n.verified }))} scope={shell.scope} />
            <SectionTabs />
            <main id="contenu-principal" className="relative min-w-0 flex-1 pb-28 md:pb-0">
              <ScopeGate pending={shell.pending}>{children}</ScopeGate>
            </main>
          </div>
        </div>
        <MobileTabBar />
        <KeyboardProvider isAdmin={user.role === 'admin'} />
        <AppToaster />
      </TooltipProvider>
    </NuqsAdapter>
  );
}
