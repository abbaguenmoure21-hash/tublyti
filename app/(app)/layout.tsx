import { cookies } from 'next/headers';
import { Toaster } from 'sonner';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from '@/components/app-sidebar';
import { MobileTabBar } from '@/components/mobile-tab-bar';
import { KeyboardProvider } from '@/components/keyboard-provider';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sidebarCollapsed = cookieStore.get('tublyti-sidebar')?.value === 'collapsed';

  return (
    <NuqsAdapter>
      <TooltipProvider delay={300}>
        <div className="flex h-full min-h-screen">
          <AppSidebar defaultCollapsed={sidebarCollapsed} />
          <main className="flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>
        </div>
        <MobileTabBar />
        <KeyboardProvider />
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </NuqsAdapter>
  );
}
