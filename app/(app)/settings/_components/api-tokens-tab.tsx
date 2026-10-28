'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Plus, Copy, Check, Trash2, Shield, ShieldAlert } from 'lucide-react';
import { createApiToken, revokeApiToken } from '@/lib/actions/api-tokens';
import { ConfirmDialog } from './confirm-dialog';

interface TokenData {
  id: string;
  name: string;
  tokenPrefix: string;
  permission: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** A value shown in monospace with its own "Copier" button. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copie impossible. Sélectionne le texte et copie-le à la main.');
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="flex h-9 min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-card px-3 font-mono text-[12px]">
          {value}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copier : ${label}`}
          className="flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border bg-card px-3 text-[13px] transition-colors hover:bg-muted"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
    </div>
  );
}

const PERMISSIONS = [
  { value: 'read' as const, label: 'Lecture seule', help: 'Claude ou l’extension peuvent consulter tes sujets, sans rien changer.' },
  { value: 'readwrite' as const, label: 'Lecture et actions', help: 'Ils peuvent aussi créer des vidéos et ajouter des favoris pour toi.' },
];

export function ApiTokensTab({ tokens, mcpUrl }: { tokens: TokenData[]; mcpUrl: string }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<'read' | 'readwrite'>('read');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [toRevoke, setToRevoke] = useState<TokenData | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await createApiToken(name.trim(), permission);
      if (result.error) {
        toast.error(result.error);
      } else if (result.token) {
        setNewToken(result.token);
        setName('');
        toast.success('Jeton créé. Copie-le maintenant : il ne sera plus affiché.');
      }
    });
  }

  function handleRevoke(token: TokenData) {
    startTransition(async () => {
      const result = await revokeApiToken(token.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Jeton « ${token.name} » révoqué.`);
        setToRevoke(null);
      }
    });
  }

  const activeTokens = tokens.filter((t) => !t.revokedAt);
  const revokedTokens = tokens.filter((t) => t.revokedAt);
  const currentHelp = PERMISSIONS.find((p) => p.value === permission)?.help;

  return (
    <div className="space-y-4">
      <div className="elev-1 rounded-xl bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Jetons d’accès</h2>
          <button
            type="button"
            onClick={() => {
              setShowCreate(true);
              setNewToken(null);
            }}
            className="flex h-9 cursor-pointer items-center gap-1 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Nouveau jeton
          </button>
        </div>

        {/* New token creation form */}
        {showCreate && (
          <div className="space-y-3 border-b border-border px-5 py-4">
            {newToken ? (
              <div className="space-y-3">
                <p className="text-[13px] font-medium text-foreground">
                  Jeton créé. Copie ces deux valeurs maintenant : le jeton ne sera plus affiché.
                </p>
                <CopyField label="Adresse du serveur" value={mcpUrl} />
                <CopyField label="Jeton" value={newToken} />
                <p className="text-[13px] text-muted-foreground">
                  Colle-les dans Claude › Réglages › Connecteurs, ou dans les options de l’extension Chrome TubLyTI.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setNewToken(null);
                  }}
                  className="h-9 cursor-pointer text-[13px] text-muted-foreground hover:text-foreground"
                >
                  J’ai copié, fermer
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="min-w-0 sm:min-w-[200px] sm:flex-1">
                  <label htmlFor="token-name" className="mb-1 block text-[12px] text-muted-foreground">Nom</label>
                  <input
                    id="token-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Claude, extension Chrome…"
                    autoFocus
                    className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[13px] text-foreground"
                  />
                </div>
                <div>
                  <span id="token-permission" className="mb-1 block text-[12px] text-muted-foreground">Ce qu’il peut faire</span>
                  <div role="radiogroup" aria-labelledby="token-permission" className="flex gap-1">
                    {PERMISSIONS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        role="radio"
                        aria-checked={permission === p.value}
                        onClick={() => setPermission(p.value)}
                        className={`h-9 cursor-pointer rounded-lg px-3 text-[12px] font-medium transition-colors ${
                          permission === p.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={isPending || !name.trim()}
                    className="h-9 cursor-pointer rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isPending ? 'Création…' : 'Créer'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="h-9 cursor-pointer px-3 text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    Annuler
                  </button>
                </div>
                <p className="text-[12px] text-muted-foreground sm:basis-full">{currentHelp}</p>
              </div>
            )}
          </div>
        )}

        {/* Token list */}
        {activeTokens.length === 0 && !showCreate ? (
          <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">
            Aucun jeton actif.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {activeTokens.map((token) => (
              <div key={token.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {token.permission === 'readwrite' ? (
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-phase-1" aria-label="Lecture et actions" />
                  ) : (
                    <Shield className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Lecture seule" />
                  )}
                  <span className="truncate text-[13px] font-medium">{token.name}</span>
                  <code className="font-mono text-[11px] text-muted-foreground">
                    {token.tokenPrefix}…
                  </code>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {token.lastUsedAt
                    ? `Utilisé le ${new Date(token.lastUsedAt).toLocaleDateString('fr-FR')}`
                    : 'Jamais utilisé'}
                </span>
                <button
                  type="button"
                  onClick={() => setToRevoke(token)}
                  disabled={isPending}
                  aria-label={`Révoquer le jeton ${token.name}`}
                  title="Révoquer"
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-8 sm:w-8"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={toRevoke !== null}
        onOpenChange={(o) => {
          if (!o) setToRevoke(null);
        }}
        title={toRevoke ? `Révoquer « ${toRevoke.name} » ?` : 'Révoquer ce jeton ?'}
        description="Claude ou l’extension qui l’utilisent perdront l’accès tout de suite. Ce n’est pas réversible : il faudra créer un nouveau jeton."
        confirmLabel="Révoquer"
        pending={isPending}
        onConfirm={() => toRevoke && handleRevoke(toRevoke)}
      />

      {/* Revoked tokens */}
      {revokedTokens.length > 0 && (
        <details className="text-[12px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            {revokedTokens.length} jeton{revokedTokens.length > 1 ? 's' : ''} révoqué{revokedTokens.length > 1 ? 's' : ''}
          </summary>
          <div className="mt-2 space-y-1">
            {revokedTokens.map((t) => (
              <div key={t.id} className="flex items-center gap-2 opacity-50">
                <span className="line-through">{t.name}</span>
                <code className="font-mono">{t.tokenPrefix}…</code>
                <span>révoqué le {new Date(t.revokedAt!).toLocaleDateString('fr-FR')}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
