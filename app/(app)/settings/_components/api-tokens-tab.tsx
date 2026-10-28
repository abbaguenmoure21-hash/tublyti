'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Plus, Copy, Check, Trash2, Shield, ShieldAlert } from 'lucide-react';
import { createApiToken, revokeApiToken } from '@/lib/actions/api-tokens';

interface TokenData {
  id: string;
  name: string;
  tokenPrefix: string;
  permission: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export function ApiTokensTab({ tokens }: { tokens: TokenData[] }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState<'read' | 'readwrite'>('read');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
        toast.success('Jeton créé. Copie-le maintenant — il ne sera plus affiché.');
      }
    });
  }

  function handleRevoke(tokenId: string) {
    startTransition(async () => {
      const result = await revokeApiToken(tokenId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Jeton révoqué.');
      }
    });
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const activeTokens = tokens.filter((t) => !t.revokedAt);
  const revokedTokens = tokens.filter((t) => t.revokedAt);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)]">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Jetons d’accès</h2>
          <button
            type="button"
            onClick={() => {
              setShowCreate(true);
              setNewToken(null);
            }}
            className="flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            Nouveau jeton
          </button>
        </div>

        {/* New token creation form */}
        {showCreate && (
          <div className="px-5 py-4 border-b border-border bg-muted/20 space-y-3">
            {newToken ? (
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-foreground">
                  Jeton créé — copie-le maintenant :
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 h-9 px-3 border border-border rounded-lg bg-card text-[12px] font-mono flex items-center overflow-x-auto">
                    {newToken}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(newToken)}
                    className="h-9 px-3 rounded-lg border border-border bg-card text-[13px] flex items-center gap-1 hover:bg-muted transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copié' : 'Copier'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setNewToken(null);
                  }}
                  className="text-[12px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            ) : (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label htmlFor="token-field-1" className="text-[12px] text-muted-foreground block mb-1">Nom</label>
                  <input
                    id="token-field-1"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Claude, extension Chrome…"
                    autoFocus
                    className="h-9 w-full px-3 border border-border rounded-lg bg-card text-[13px] text-foreground"
                  />
                </div>
                <div>
                  <span id="token-permission" className="text-[12px] text-muted-foreground block mb-1">Permission</span>
                  <div className="flex gap-1" role="group" aria-labelledby="token-permission">
                    <button
                      type="button"
                      onClick={() => setPermission('read')}
                      aria-pressed={permission === 'read'}
                      className={`h-9 px-3 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
                        permission === 'read'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      Consulter seulement
                    </button>
                    <button
                      type="button"
                      onClick={() => setPermission('readwrite')}
                      aria-pressed={permission === 'readwrite'}
                      className={`h-9 px-3 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${
                        permission === 'readwrite'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      Consulter et agir (créer des vidéos, favoris)
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={isPending || !name.trim()}
                  className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isPending ? 'Création…' : 'Créer'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="h-9 px-3 text-[13px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Annuler
                </button>
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
              <div key={token.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  {token.permission === 'readwrite' ? (
                    <ShieldAlert className="w-3.5 h-3.5 text-phase-1" />
                  ) : (
                    <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                  <span className="text-[13px] font-medium">{token.name}</span>
                  <code className="text-[11px] font-mono text-muted-foreground">
                    {token.tokenPrefix}…
                  </code>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {token.lastUsedAt
                    ? `Utilisé ${new Date(token.lastUsedAt).toLocaleDateString('fr-FR')}`
                    : 'Jamais utilisé'}
                </span>
                <button
                  type="button"
                  onClick={() => handleRevoke(token.id)}
                  disabled={isPending}
                  aria-label={`Supprimer l’accès ${token.name}`}
                  className="relative after:absolute after:-inset-2 md:after:hidden w-7 h-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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
