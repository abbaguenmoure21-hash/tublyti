import { redirect } from 'next/navigation';
import { Toaster } from 'sonner';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar } from '@/components/app-shell/sidebar';
import { SectionTabs } from '@/components/app-shell/section-tabs';
import { MobileTabBar } from '@/components/mobile-tab-bar';
import { KeyboardProvider } from '@/components/keyboard-provider';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser, isDbReady } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';

async function getShellData(userId: string, ready: boolean) {
  const db = createServiceClient();
  try {
    let videosQ = db.from('angles').select('id', { count: 'exact', head: true }).in('status', ['idea', 'in_production']);
    if (ready) videosQ = videosQ.eq('user_id', userId);
    const [{ scope, niches }, inProgress, lastScore] = await Promise.all([
      resolveScope(db, userId),
      videosQ,
      db.from('jobs').select('finished_at').eq('kind', 'score').not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1),
    ]);
    const last = lastScore.data?.[0]?.finished_at as string | undefined;
    const dataFresh = last ? Date.now() - new Date(last).getTime() < 36 * 3_600_000 : false;
    return { niches, scope, badges: { videos: inProgress.count ?? 0 }, dataFresh };
  } catch {
    return { niches: [], scope: null, badges: {}, dataFresh: false };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const ready = await isDbReady();
  const shell = await getShellData(user.id, ready);

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
          />
          <div className="flex min-w-0 flex-1 flex-col">
            {!ready && (
              <p role="status" className="mx-4 mt-4 rounded-2xl bg-phase-1-soft px-4 py-3 text-[13px] text-phase-1-ink shadow-sm md:mx-8">
                Mise à jour de la base à faire : exécute la migration <strong>00018_clients_et_roles.sql</strong> dans Supabase pour activer
                les comptes clients. En attendant, l’app fonctionne comme avant.
              </p>
            )}
            <SectionTabs />
            <main id="contenu-principal" className="relative min-w-0 flex-1 pb-28 md:pb-0">
              {children}
            </main>
          </div>
        </div>
        <MobileTabBar />
        <KeyboardProvider isAdmin={user.role === 'admin'} />
        <Toaster position="bottom-center" toastOptions={{ className: 'rounded-xl' }} />
      </TooltipProvider>
    </NuqsAdapter>
  );
}
