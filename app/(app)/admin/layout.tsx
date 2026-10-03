import { requireAdmin } from '@/lib/auth/session';

/** Console d'administration : réservée au rôle admin (les clients sont renvoyés vers Sujets). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return children;
}
