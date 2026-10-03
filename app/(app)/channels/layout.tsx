import { requireAdmin } from '@/lib/auth/session';

/** Le catalogue des chaînes analysées fait partie de la console d'administration. */
export default async function ChannelsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return children;
}
