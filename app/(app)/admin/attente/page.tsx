import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';

export const metadata = { title: 'Liste d’attente · Console' };

const SOURCE: Record<string, string> = { hero: 'Haut de page', final: 'Bas de page' };

export default async function AttentePage() {
  await requireAdmin();
  const db = createServiceClient();
  const { data, count } = await db
    .from('waitlist')
    .select('id, email, source, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(500);
  const rows = (data ?? []) as { id: string; email: string; source: string | null; created_at: string }[];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Liste d’attente</h1>
        <p className="text-[15px] text-muted-foreground">
          {count ?? 0} inscription{(count ?? 0) > 1 ? 's' : ''} depuis la page d’accueil. Pour ouvrir un accès, crée le compte dans Supabase (Authentication), puis il apparaîtra dans « Clients ».
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">Aucune inscription pour l’instant.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-background text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Adresse</th>
                <th className="px-4 py-2.5 font-medium">Formulaire</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-muted">
                  <td className="px-4 py-2.5 font-medium">{r.email}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{SOURCE[r.source ?? ''] ?? r.source ?? '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{new Date(r.created_at).toLocaleDateString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
