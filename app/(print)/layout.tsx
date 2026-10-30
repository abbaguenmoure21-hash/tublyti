import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';

/**
 * Minimal shell for printable pages: no sidebar, no mobile tab bar.
 * Access checks (topic scope) stay in each page.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return <div className="min-h-full bg-background text-foreground">{children}</div>;
}
