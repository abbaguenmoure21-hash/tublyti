import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/supabase/server';
import { loadMyChannels } from '@/lib/my-channels';
import { googleEnabled } from '@/lib/youtube/google-oauth';
import { readGoogleChannels } from '@/lib/actions/compte';
import { requireUser, getToolsUser } from '@/lib/auth/session';
import { getAlertRules } from '@/lib/actions/alerts';
import { listApiTokens } from '@/lib/actions/api-tokens';
import { getCollections } from '@/lib/actions/collections';
import { AlertsTab } from '../settings/_components/alerts-tab';
import { ApiTokensTab } from '../settings/_components/api-tokens-tab';
import { DigestButton } from './_client/digest-button';
import { nicheColor } from '@/lib/scope';
import { MyChannels } from './_client/my-channels';
import { FollowedNiches } from './_client/followed-niches';
import { ProfileForm } from './_client/profile-form';
import { ThemeChoice } from './_client/theme-choice';

export const metadata: Metadata = { title: 'Réglages' };

/** Réglages du client : ses chaînes, les thématiques qu'il suit, son profil, l'apparence. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string; verifier?: string }> }) {
  const sp = await searchParams;
  const googleStatus = sp.google ?? null;
  const user = await requireUser();
  const db = createServiceClient();
  const [followedRes, nichesRes] = await Promise.all([
    db.from('user_niches').select('niche_id').eq('user_id', user.id),
    db.from('niches').select('id, name, category').eq('status', 'active').order('name'),
  ]);

  const catalogue = ((nichesRes.data ?? []) as { id: string; name: string; category: string | null }[]).map((n) => ({
    id: n.id,
    name: n.name,
    color: nicheColor(n.category),
  }));
  const nicheName = new Map(catalogue.map((n) => [n.id, n.name]));
  const channels = await loadMyChannels(db, user.id, nicheName);
  const followed = ((followedRes.data ?? []) as { niche_id: string }[]).map((f) => f.niche_id);

  // Alertes et jetons : propres au compte (migration 00019). Avant : réservés à l'administration.
  const tools = await getToolsUser();
  const [rulesRes, tokensRes, collectionsRes] = tools
    ? await Promise.all([getAlertRules(), listApiTokens(), getCollections()])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const myNiches = [
    ...channels.map((c) => ({ id: c.nicheId, name: `${c.title} · ${c.nicheName}` })),
    ...catalogue.filter((n) => followed.includes(n.id)).map((n) => ({ id: n.id, name: n.name })),
  ];
  const nichesForAlerts = user.role === 'admin' ? catalogue.map((n) => ({ id: n.id, name: n.name })) : myNiches;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tublyti.vercel.app';

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-10 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">Réglages</h1>
        <p className="text-[15px] text-muted-foreground">Tes chaînes décident des sujets que TubLyTI te montre.</p>
      </header>

      <section id="chaines" aria-labelledby="titre-chaines" className="flex scroll-mt-6 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="titre-chaines" className="text-lg font-semibold">Mes chaînes</h2>
          <p className="text-sm text-muted-foreground">Ajoute chaque chaîne avec son lien YouTube : TubLyTI vérifie qu’elle t’appartient, puis lit ses abonnés et ses vidéos. Chaque chaîne apparaît dans « Afficher ».</p>
        </div>
        <MyChannels channels={channels} catalogue={catalogue} googleEnabled={googleEnabled()} googleChannels={await readGoogleChannels()} googleStatus={googleStatus} returnTo="settings" autoVerifyId={sp.verifier ?? null} />
      </section>

      <section aria-labelledby="titre-themes" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="titre-themes" className="text-lg font-semibold">Thématiques à explorer</h2>
          <p className="text-sm text-muted-foreground">Suis une thématique sans y avoir de chaîne, pour repérer des sujets avant de te lancer.</p>
        </div>
        <FollowedNiches catalogue={catalogue} followed={followed} withChannel={channels.map((c) => c.nicheId)} />
      </section>

      <section id="alertes" aria-labelledby="titre-alertes" className="flex scroll-mt-6 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="titre-alertes" className="text-lg font-semibold">Alertes</h2>
          <p className="text-sm text-muted-foreground">Reçois un e-mail quand un sujet de tes chaînes devient le bon moment, ou qu’un de tes favoris change.</p>
        </div>
        {tools ? (
          <AlertsTab
            rules={(rulesRes.data ?? []).map((r: Record<string, unknown>) => ({
              id: r.id as string,
              rule_type: r.rule_type as never,
              params: (r.params as Record<string, unknown>) ?? {},
              label: r.label as string,
              instant_email: r.instant_email as boolean,
              enabled: r.enabled as boolean,
              created_at: r.created_at as string,
            }))}
            niches={nichesForAlerts}
            collections={(collectionsRes.data ?? []).map((c: Record<string, unknown>) => ({ id: c.id as string, name: c.name as string }))}
            isAdmin={user.role === 'admin'}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">Les alertes arrivent très bientôt sur ton compte.</p>
        )}
        <DigestButton email={user.email} />
      </section>

      <section id="claude" aria-labelledby="titre-claude" className="flex scroll-mt-6 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="titre-claude" className="text-lg font-semibold">Connexion à Claude</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Pose tes questions à Claude sur tes sujets (« quels sujets choisir cette semaine ? »). Crée un jeton ci-dessous, puis ajoute un connecteur
            personnalisé dans Claude avec l’adresse <code className="rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground">{appUrl}/api/mcp</code> et ce jeton.
            Un jeton ne donne accès qu’à tes chaînes et à tes thématiques.
          </p>
        </div>
        {tools ? (
          <ApiTokensTab
            tokens={(tokensRes.data ?? []).map((t: Record<string, unknown>) => ({
              id: t.id as string,
              name: t.name as string,
              tokenPrefix: t.token_prefix as string,
              permission: t.permission as string,
              lastUsedAt: (t.last_used_at as string) ?? null,
              createdAt: t.created_at as string,
              revokedAt: (t.revoked_at as string) ?? null,
            }))}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">La connexion à Claude arrive très bientôt sur ton compte.</p>
        )}
      </section>

      <section aria-labelledby="titre-profil" className="flex flex-col gap-3">
        <h2 id="titre-profil" className="text-lg font-semibold">Profil</h2>
        <ProfileForm displayName={user.displayName} email={user.email} />
      </section>

      <section aria-labelledby="titre-apparence" className="flex flex-col gap-3">
        <h2 id="titre-apparence" className="text-lg font-semibold">Apparence</h2>
        <ThemeChoice />
      </section>
    </div>
  );
}
