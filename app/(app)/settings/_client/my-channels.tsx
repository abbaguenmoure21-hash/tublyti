'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Trash2, Copy, Check, ShieldCheck, Search, Link2 } from 'lucide-react';
import { previewMyChannel, addMyChannel, verifyMyChannel, removeMyChannel, addGoogleChannel, dismissGoogleChannels, type ChannelPreview } from '@/lib/actions/compte';
import type { MyChannel } from '@/lib/my-channels';

interface Niche { id: string; name: string; color: string }

const field = 'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring';
const nf = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

function Avatar({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" referrerPolicy="no-referrer" width={size} height={size} className="shrink-0 rounded-full bg-muted object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground" style={{ width: size, height: size }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Ajout d'une chaîne en trois temps : lien → aperçu et thématique → code de vérification. */
interface GoogleChannel { id: string; title: string; handle: string | null; thumbnailUrl: string | null; subscriberCount: number | null; videoCount: number }

const GOOGLE_STATUS: Record<string, string> = {
  annule: 'Connexion Google annulée.',
  expire: 'La connexion Google a expiré. Recommence.',
  erreur: 'Google n’a pas répondu correctement. Réessaie, ou ajoute ta chaîne avec son lien.',
  aucune: 'Aucune chaîne YouTube sur ce compte Google. Si ta chaîne est sur un compte de marque, choisis-le à l’écran Google.',
  indisponible: 'La connexion Google n’est pas encore disponible. Ajoute ta chaîne avec son lien.',
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}

export function MyChannels({
  channels,
  catalogue,
  googleEnabled = false,
  googleChannels = [],
  googleStatus = null,
  returnTo = 'settings',
  autoVerifyId = null,
}: {
  channels: MyChannel[];
  catalogue: Niche[];
  googleEnabled?: boolean;
  googleChannels?: GoogleChannel[];
  googleStatus?: string | null;
  returnTo?: 'settings' | 'bienvenue';
  /** Ouvre directement la vérification de cette chaîne (lien « Vérifier la chaîne »). */
  autoVerifyId?: string | null;
}) {
  // Une chaîne déjà enregistrée garde sa thématique quand Google la retrouve.
  const [googleNiche, setGoogleNiche] = useState<Record<string, string>>(() =>
    Object.fromEntries(channels.filter((c) => c.youtubeId).map((c) => [c.youtubeId as string, c.nicheId])),
  );
  const autoTarget = autoVerifyId ? channels.find((c) => c.id === autoVerifyId && c.status === 'pending') ?? null : null;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<'idle' | 'search' | 'verify'>(
    autoTarget ? 'verify' : channels.length === 0 && !googleEnabled ? 'search' : 'idle',
  );
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<ChannelPreview | null>(null);
  const [nicheId, setNicheId] = useState('');
  const [verifying, setVerifying] = useState<{ id: string; code: string; title: string } | null>(
    autoTarget ? { id: autoTarget.id, code: autoTarget.code ?? '', title: autoTarget.title } : null,
  );
  const [copied, setCopied] = useState(false);
  const [replacing, setReplacing] = useState<string | null>(null);

  function addFromGoogle(c: GoogleChannel) {
    const nid = googleNiche[c.id];
    if (!nid) {
      toast.error('Choisis d’abord la thématique de cette chaîne.');
      return;
    }
    startTransition(async () => {
      const res = await addGoogleChannel(c.id, nid);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${c.title} ajoutée et vérifiée`, {
        description: res.imported ? `${res.imported} vidéos importées : tes résultats sont prêts.` : undefined,
      });
      router.refresh();
    });
  }

  function reset() {
    setStep(channels.length === 0 && !googleEnabled ? 'search' : 'idle');
    setLink('');
    setPreview(null);
    setNicheId('');
    setVerifying(null);
    setReplacing(null);
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await previewMyChannel(link);
      if (res.error || !res.channel) {
        toast.error(res.error ?? 'Chaîne introuvable.');
        return;
      }
      setPreview(res.channel);
      if (res.alreadyMine) toast('Cette chaîne est déjà dans ta liste : tu peux finir sa vérification.');
    });
  }

  function add() {
    if (!preview || !nicheId) return;
    startTransition(async () => {
      const res = await addMyChannel({ youtube: preview.id, nicheId });
      if (res.error || !res.id) {
        toast.error(res.error ?? 'La chaîne n’a pas pu être ajoutée.');
        return;
      }
      if (res.verified) {
        toast.success('Chaîne déjà vérifiée');
        reset();
        router.refresh();
        return;
      }
      setVerifying({ id: res.id, code: res.code ?? '', title: preview.title });
      setStep('verify');
      router.refresh();
    });
  }

  function verify(id: string) {
    startTransition(async () => {
      const res = await verifyMyChannel(id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success('Chaîne vérifiée', {
        description: res.imported ? `${res.imported} vidéos importées : tes résultats sont prêts.` : 'Ses sujets apparaissent dans « Sujets ».',
      });
      reset();
      router.refresh();
    });
  }

  function remove(c: MyChannel) {
    startTransition(async () => {
      const res = await removeMyChannel(c.id);
      if ('error' in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast(`${c.title} retirée`, { description: 'Tes vidéos déjà créées restent dans « Mes vidéos ».' });
      router.refresh();
    });
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Copie impossible : sélectionne le code à la main.');
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {googleStatus && GOOGLE_STATUS[googleStatus] && googleChannels.length === 0 && (
        <p role="status" className="border-b border-muted bg-phase-1-soft px-4 py-3 text-sm text-phase-1-ink">{GOOGLE_STATUS[googleStatus]}</p>
      )}
      {googleChannels.length > 0 && (
        <section aria-label="Chaînes trouvées sur ton compte Google" className="flex flex-col gap-3 border-b border-muted bg-background px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <GoogleMark /> Chaînes de ton compte Google
            </p>
            <button
              type="button"
              onClick={() => startTransition(async () => { await dismissGoogleChannels(); router.refresh(); })}
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Fermer
            </button>
          </div>
          <p className="text-sm text-muted-foreground">Google a confirmé qu’elles sont à toi. Choisis la thématique de chacune, puis ajoute-la.</p>
          <ul className="flex flex-col gap-2">
            {googleChannels.map((c) => {
              const added = channels.some((m) => m.youtubeId === c.id && m.status === 'verified');
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-card px-3 py-3">
                  <Avatar src={c.thumbnailUrl} name={c.title} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-medium">{c.title}</span>
                    <span className="truncate text-[13px] text-muted-foreground">
                      {c.handle ?? c.id}
                      {c.subscriberCount != null ? ` · ${nf.format(c.subscriberCount)} abonnés` : ''} · {nf.format(c.videoCount)} vidéos
                    </span>
                  </span>
                  {added ? (
                    <span className="flex items-center gap-1 text-sm font-medium text-phase-2-ink">
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Ajoutée
                    </span>
                  ) : (
                    <span className="flex w-full items-center gap-2 sm:w-auto">
                      <select
                        aria-label={`Thématique de ${c.title}`}
                        value={googleNiche[c.id] ?? ''}
                        onChange={(e) => setGoogleNiche((g) => ({ ...g, [c.id]: e.target.value }))}
                        className="h-10 min-w-0 flex-1 rounded-[10px] border border-input bg-card px-2 text-sm sm:w-56"
                      >
                        <option value="" disabled>Thématique…</option>
                        {catalogue.map((n) => (
                          <option key={n.id} value={n.id}>{n.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => addFromGoogle(c)}
                        disabled={pending || !googleNiche[c.id]}
                        className="h-10 shrink-0 rounded-[10px] bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                      >
                        Ajouter
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {channels.length > 0 && (
        <ul>
          {channels.map((c) => (
            <li key={c.id} className="flex items-center gap-3 border-b border-muted px-4 py-3">
              <Avatar src={c.thumbnailUrl} name={c.title} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-medium">{c.title}</span>
                  {c.status === 'verified' && c.youtubeId && (
                    <ShieldCheck className="h-4 w-4 shrink-0 text-phase-2" aria-label="Propriété vérifiée" />
                  )}
                </span>
                <span className="truncate text-[13px] text-muted-foreground">
                  {c.nicheName}
                  {c.handle ? ` · ${c.handle}` : ''}
                  {c.subscribers != null ? ` · ${nf.format(c.subscribers)} abonnés` : ''}
                </span>
              </span>
              {c.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => {
                    setVerifying({ id: c.id, code: c.code ?? '', title: c.title });
                    setStep('verify');
                  }}
                  className="h-9 shrink-0 rounded-[10px] bg-phase-1-soft px-3 text-[13px] font-medium text-phase-1-ink"
                >
                  À vérifier
                </button>
              )}
              {c.status === 'legacy' && (
                <button
                  type="button"
                  onClick={() => {
                    setReplacing(c.id);
                    setNicheId(c.nicheId);
                    setStep('search');
                  }}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium hover:bg-muted"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Relier à YouTube
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(c)}
                disabled={pending}
                aria-label={`Retirer ${c.title}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {step === 'idle' &&
        (googleEnabled ? (
          <div className="flex flex-col gap-3 px-4 py-4">
            <p className="text-sm font-medium">Ajouter une chaîne</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <a
                href={`/api/youtube/connect?retour=${returnTo}`}
                className="elev-1 flex flex-col gap-1 rounded-xl bg-card px-4 py-3 transition-shadow hover:elev-2"
              >
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                  <GoogleMark /> Avec Google
                </span>
                <span className="text-[13px] leading-snug text-muted-foreground">
                  Le plus rapide : tu choisis ton compte, Google confirme que la chaîne est à toi.
                </span>
              </a>
              <button type="button" onClick={() => setStep('search')} className="elev-1 flex flex-col gap-1 rounded-xl bg-card px-4 py-3 text-left transition-shadow hover:elev-2">
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                  <Link2 className="h-4 w-4" aria-hidden="true" /> Avec un lien
                </span>
                <span className="text-[13px] leading-snug text-muted-foreground">
                  Tu colles le lien de ta chaîne, puis un code dans sa description pour prouver qu’elle est à toi.
                </span>
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setStep('search')} className="flex h-12 w-full items-center gap-2 px-4 text-sm font-medium text-primary hover:bg-muted">
            <Plus className="h-4 w-4" aria-hidden="true" /> Ajouter une chaîne
          </button>
        ))}

      {step === 'search' && (
        <div className="flex flex-col gap-4 px-4 py-4">
          {!preview ? (
            <form onSubmit={search} className="flex flex-col gap-2">
              <label htmlFor="lien-chaine" className="text-sm font-medium">
                {replacing ? 'Lien YouTube de cette chaîne' : 'Lien de ta chaîne YouTube'}
              </label>
              <div className="flex gap-2">
                <input
                  id="lien-chaine"
                  autoFocus
                  required
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="youtube.com/@machaine"
                  className={field}
                />
                <button type="submit" disabled={pending || !link.trim()} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
                  <Search className="h-4 w-4" aria-hidden="true" /> {pending ? 'Recherche…' : 'Rechercher'}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Le lien de ta chaîne, ton @pseudo ou le lien d’une de tes vidéos. TubLyTI lit le reste sur YouTube.</p>
              {(channels.length > 0 || googleEnabled) && (
                <button type="button" onClick={reset} className="self-start text-sm font-medium text-muted-foreground hover:text-foreground">
                  Annuler
                </button>
              )}
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="well flex items-center gap-3 rounded-xl bg-background px-4 py-3">
                <Avatar src={preview.thumbnailUrl} name={preview.title} size={48} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold">{preview.title}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {preview.handle ?? preview.id}
                    {preview.subscriberCount != null ? ` · ${nf.format(preview.subscriberCount)} abonnés` : ' · abonnés masqués'}
                    {` · ${nf.format(preview.videoCount)} vidéos`}
                  </span>
                </span>
                <button type="button" onClick={() => setPreview(null)} className="shrink-0 text-sm font-medium text-primary">
                  Changer
                </button>
              </div>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Thématique de cette chaîne
                <select required value={nicheId} onChange={(e) => setNicheId(e.target.value)} className={field}>
                  <option value="" disabled>Choisis une thématique</option>
                  {catalogue.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
                <span className="text-xs font-normal text-muted-foreground">Ta thématique n’est pas dans la liste ? Écris-nous, nous l’ajoutons.</span>
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={add} disabled={pending || !nicheId} className="inline-flex h-11 items-center rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
                  {pending ? 'Ajout…' : 'Continuer'}
                </button>
                {(channels.length > 0 || googleEnabled) && (
                  <button type="button" onClick={reset} className="inline-flex h-11 items-center rounded-[10px] px-4 text-sm font-medium text-muted-foreground hover:bg-muted">
                    Annuler
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'verify' && verifying && (
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-1">
            <p className="text-[15px] font-semibold">Prouve que « {verifying.title} » est ta chaîne</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Pour éviter qu’on ajoute la chaîne de quelqu’un d’autre, colle ce code dans la description de ta chaîne, puis clique sur « Vérifier ».
              Tu pourras l’enlever dès que c’est fait.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="well flex h-11 flex-1 items-center rounded-[10px] bg-background px-3 font-mono text-[15px] font-semibold tracking-wide">{verifying.code}</code>
            <button type="button" onClick={() => copy(verifying.code)} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] border border-border px-3 text-sm font-medium hover:bg-muted">
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
            <li>
              Ouvre{' '}
              <a href="https://studio.youtube.com" target="_blank" rel="noopener noreferrer" className="font-medium text-primary">
                YouTube Studio
              </a>{' '}
              › Personnalisation › Informations générales.
            </li>
            <li>Colle le code n’importe où dans la description, puis clique sur « Publier ».</li>
            <li>Reviens ici et clique sur « Vérifier » (YouTube peut mettre quelques minutes à l’afficher).</li>
          </ol>
          <div className="flex gap-2">
            <button type="button" onClick={() => verify(verifying.id)} disabled={pending} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {pending ? 'Vérification…' : 'Vérifier'}
            </button>
            {googleEnabled && (
              <a
                href={`/api/youtube/connect?retour=${returnTo}`}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-border px-4 text-sm font-medium hover:bg-muted"
              >
                <GoogleMark /> Vérifier avec Google
              </a>
            )}
            <button type="button" onClick={reset} className="inline-flex h-11 items-center rounded-[10px] px-4 text-sm font-medium text-muted-foreground hover:bg-muted">
              Plus tard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
