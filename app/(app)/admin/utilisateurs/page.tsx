import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { RoleSelect } from './role-select';

export const metadata = { title: 'Clients · Console' };

export default async function UtilisateursPage() {
  const me = await requireAdmin();
  const db = createServiceClient();
  const [usersRes, profilesRes, channelsRes, videosRes] = await Promise.all([
    db.auth.admin.listUsers({ perPage: 500 }),
    db.from('profiles').select('user_id, role, display_name, onboarded_at'),
    db.from('user_channels').select('user_id, title'),
    db.from('angles').select('user_id').not('user_id', 'is', null),
  ]);
  const readError = usersRes.error ?? profilesRes.error ?? channelsRes.error ?? videosRes.error;
  if (readError) throw new Error(readError.message);

  const profiles = new Map(
    ((profilesRes.data ?? []) as { user_id: string; role: string; display_name: string | null }[]).map((p) => [p.user_id, p]),
  );
  const channelsBy = new Map<string, string[]>();
  for (const c of (channelsRes.data ?? []) as { user_id: string; title: string }[]) {
    channelsBy.set(c.user_id, [...(channelsBy.get(c.user_id) ?? []), c.title]);
  }
  const videosBy = new Map<string, number>();
  for (const v of (videosRes.data ?? []) as { user_id: string }[]) videosBy.set(v.user_id, (videosBy.get(v.user_id) ?? 0) + 1);

  type AuthUser = { id: string; email?: string; last_sign_in_at?: string | null };
  type Row = { id: string; email: string; name: string | null; role: 'client' | 'admin'; lastSignIn: string | null; channels: string[]; videos: number };
  const users: Row[] = ((usersRes.data?.users ?? []) as AuthUser[])
    .map((u): Row => ({
      id: u.id,
      email: u.email ?? '',
      name: profiles.get(u.id)?.display_name ?? null,
      role: (profiles.get(u.id)?.role === 'admin' ? 'admin' : 'client') as 'client' | 'admin',
      lastSignIn: u.last_sign_in_at ?? null,
      channels: channelsBy.get(u.id) ?? [],
      videos: videosBy.get(u.id) ?? 0,
    }))
    .sort((a: Row, b: Row) => (b.lastSignIn ?? '').localeCompare(a.lastSignIn ?? ''));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Clients</h1>
        <p className="text-[15px] text-muted-foreground">
          {users.length} compte{users.length > 1 ? 's' : ''}. Chaque client ne voit que ses chaînes, ses sujets ignorés et ses vidéos.
        </p>
      </header>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-background text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Compte</th>
              <th className="px-4 py-2.5 font-medium">Chaînes</th>
              <th className="px-4 py-2.5 font-medium">Vidéos</th>
              <th className="px-4 py-2.5 font-medium">Dernière connexion</th>
              <th className="px-4 py-2.5 font-medium">Rôle</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Aucun compte pour l’instant.</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-muted align-top">
                <td className="px-4 py-3">
                  <span className="block font-medium">{u.name ?? u.email.split('@')[0]}</span>
                  <span className="block text-xs text-muted-foreground">{u.email}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{u.channels.length ? u.channels.join(', ') : <span className="text-phase-1-ink">Aucune chaîne</span>}</td>
                <td className="px-4 py-3 tabular-nums">{u.videos}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString('fr-FR') : 'Jamais'}</td>
                <td className="px-4 py-3"><RoleSelect userId={u.id} role={u.role} self={u.id === me.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
