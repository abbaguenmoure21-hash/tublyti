import { cookies } from 'next/headers';
import { Toaster } from 'sonner';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from '@/components/app-sidebar';
import { MobileTabBar } from '@/components/mobile-tab-bar';
import { KeyboardProvider } from '@/components/keyboard-provider';
import { TopNav } from '@/components/top-nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sidebarCollapsed = cookieStore.get('tublyti-sidebar')?.value === 'collapsed';

  return (
    <NuqsAdapter>
      <TooltipProvider delay={300}>
        <div className="flex h-full min-h-screen gap-4 bg-background">
          <AppSidebar defaultCollapsed={sidebarCollapsed} />
          <div className="flex-1 flex flex-col min-w-0">
            {/* Global Top Nav Area - Scrolls away with the page */}
            <div className="hidden md:flex justify-end pt-3 pr-6 pb-2 shrink-0 z-50">
              <TopNav />
            </div>
            
            <main className="flex-1 min-w-0 pb-16 md:pb-0 relative">{children}</main>
          </div>
        </div>
        <MobileTabBar />
        <KeyboardProvider />
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </NuqsAdapter>
  );
}
