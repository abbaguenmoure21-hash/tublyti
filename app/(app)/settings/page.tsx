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
import Link from 'next/link';
import { SectionNav } from '@/components/app-shell/section-nav';
import { PageSection } from '@/components/app-shell/page-section';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';

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

  const verifiedCount = channels.filter((c) => c.status !== 'pending').length;
  const pendingCount = channels.filter((c) => c.status === 'pending').length;
  const activeRules = ((rulesRes.data ?? []) as { enabled?: boolean }[]).filter((r) => r.enabled !== false).length;
  const activeTokens = ((tokensRes.data ?? []) as { revoked_at?: string | null }[]).filter((t) => !t.revoked_at).length;

  // La prochaine chose utile à faire, affichée en haut de la page.
  const next =
    channels.length === 0
      ? { text: 'Ajoute ta première chaîne pour voir les sujets de ta niche.', href: '#chaines', cta: 'Ajouter ma chaîne' }
      : pendingCount > 0
        ? { text: `${pendingCount === 1 ? 'Une chaîne attend' : `${pendingCount} chaînes attendent`} ta vérification : sans elle, aucune donnée ne s’affiche.`, href: '#chaines', cta: 'Vérifier' }
        : activeRules === 0 && tools
          ? { text: 'Active une alerte pour être prévenu quand un sujet devient le bon moment.', href: '#alertes', cta: 'Choisir mes alertes' }
          : null;

  const nav = [
    { id: 'chaines', label: 'Mes chaînes', icon: 'tv', badge: pendingCount ? `${pendingCount} à vérifier` : channels.length ? String(channels.length) : null, badgeTone: pendingCount ? ('warn' as const) : ('neutral' as const) },
    { id: 'thematiques', label: 'Thématiques', icon: 'compass', badge: followed.length ? String(followed.length) : null },
    { id: 'alertes', label: 'Alertes', icon: 'bell', badge: activeRules ? String(activeRules) : null },
    { id: 'claude', label: 'Connexion à Claude', icon: 'sparkles', badge: activeTokens ? String(activeTokens) : null },
    { id: 'profil', label: 'Profil', icon: 'user' },
    { id: 'apparence', label: 'Apparence', icon: 'palette' },
  ];

  const summary = [
    { label: 'Chaînes vérifiées', value: verifiedCount },
    { label: 'Thématiques suivies', value: followed.length },
    { label: 'Alertes actives', value: activeRules },
  ];

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">Réglages</h1>
        <p className="text-[15px] text-muted-foreground">Tes chaînes décident des sujets que TubLyTI te montre. Tout se règle ici, et chaque changement s’enregistre tout seul.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-10">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <SectionNav label="Sections des réglages" items={nav} />
        </aside>

        <div className="flex min-w-0 flex-col gap-12">
          {/* Vue d'ensemble : où en est le compte, et la prochaine action utile */}
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-3 gap-3">
              {summary.map((s) => (
                <div key={s.label} className="flex flex-col gap-0.5 rounded-2xl bg-card px-4 py-3">
                  <dt className="text-[13px] text-muted-foreground">{s.label}</dt>
                  <dd className="text-[24px] font-semibold tabular-nums tracking-[-0.01em]">{s.value}</dd>
                </div>
              ))}
            </dl>
            {next ? (
              <a href={next.href} className="flex items-center gap-3 rounded-2xl bg-[color-mix(in_oklch,var(--warning)_12%,var(--card))] px-4 py-3 text-sm transition-colors hover:bg-[color-mix(in_oklch,var(--warning)_18%,var(--card))]">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
                <span className="flex-1">{next.text}</span>
                <span className="inline-flex shrink-0 items-center gap-1 font-medium text-primary">
                  {next.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </a>
            ) : (
              <p className="flex items-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--success,var(--primary))]" aria-hidden="true" />
                Ton compte est prêt. Les données se mettent à jour chaque nuit.
              </p>
            )}
          </div>

          <PageSection
            id="chaines"
            icon="tv"
            title="Mes chaînes"
            helpHref="/guide#faq"
            description="Colle le lien de ta chaîne, choisis sa thématique, puis prouve qu’elle est à toi. Chaque chaîne vérifiée apparaît dans « Afficher », dans la barre de gauche."
          >
            <MyChannels channels={channels} catalogue={catalogue} googleEnabled={googleEnabled()} googleChannels={await readGoogleChannels()} googleStatus={googleStatus} returnTo="settings" autoVerifyId={sp.verifier ?? null} />
          </PageSection>

          <PageSection
            id="thematiques"
            icon="compass"
            title="Thématiques à explorer"
            description="Suis une thématique sans y avoir de chaîne, pour repérer des sujets avant de te lancer."
          >
            <FollowedNiches catalogue={catalogue} followed={followed} withChannel={channels.map((c) => c.nicheId)} />
          </PageSection>

          <PageSection
            id="alertes"
            icon="bell"
            title="Alertes"
            description="Reçois un e-mail quand un sujet de tes chaînes devient le bon moment, ou qu’un de tes favoris change."
          >
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
              <p className="rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">Les alertes arrivent très bientôt sur ton compte.</p>
            )}
            <DigestButton email={user.email} />
          </PageSection>

          <PageSection
            id="claude"
            icon="sparkles"
            title="Connexion à Claude"
            description="Pose tes questions à Claude sur tes sujets, par exemple « quels sujets choisir cette semaine ? »."
          >
            <ol className="grid gap-2 sm:grid-cols-3">
              {[
                ['Crée un jeton', 'Avec le bouton ci-dessous. Copie-le tout de suite : il ne s’affiche qu’une fois.'],
                ['Ajoute un connecteur', 'Dans Claude › Réglages › Connecteurs › Ajouter un connecteur personnalisé.'],
                ['Colle l’adresse et le jeton', `Adresse : ${appUrl}/api/mcp`],
              ].map(([t, d], i) => (
                <li key={t} className="flex flex-col gap-1 rounded-2xl bg-card px-4 py-3">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary-ink">{i + 1}</span>
                    {t}
                  </span>
                  <span className="break-words text-[13px] leading-relaxed text-muted-foreground">{d}</span>
                </li>
              ))}
            </ol>
            <p className="text-[13px] text-muted-foreground">Un jeton ne donne accès qu’à tes chaînes et à tes thématiques. Tu peux le révoquer à tout moment.</p>
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
              <p className="rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">La connexion à Claude arrive très bientôt sur ton compte.</p>
            )}
          </PageSection>

          <PageSection id="profil" icon="user" title="Profil" description="Le nom affiché dans l’app et l’adresse qui reçoit tes e-mails.">
            <div className="rounded-2xl bg-card p-4 md:p-5">
              <ProfileForm displayName={user.displayName} email={user.email} />
            </div>
          </PageSection>

          <PageSection id="apparence" icon="palette" title="Apparence" description="Clair, sombre, ou le même réglage que ton ordinateur.">
            <div className="rounded-2xl bg-card p-4 md:p-5">
              <ThemeChoice />
            </div>
          </PageSection>

          <p className="pb-6 text-center text-[13px] text-muted-foreground">
            Une question ? <Link href="/guide" className="font-medium text-primary hover:underline">Ouvre l’aide</Link> ou consulte la{' '}
            <Link href="/confidentialite" className="font-medium text-primary hover:underline">page Confidentialité</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
