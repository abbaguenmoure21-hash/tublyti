import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from '@/components/app-sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delay={300}>
      <div className="flex h-full min-h-screen">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </TooltipProvider>
  );
}
