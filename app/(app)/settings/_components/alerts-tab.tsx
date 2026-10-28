'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Power,
  PowerOff,
  Bell,
  BellOff,
  Mail,
  CheckCheck,
} from 'lucide-react';
import {
  createAlertRule,
  deleteAlertRule,
  toggleAlertRule,
  getAlertEvents,
  markAllAlertsRead,
  previewRuleTriggerCount,
} from '@/lib/actions/alerts';
import type { AlertRuleType } from '@/lib/alerts/evaluate';

interface AlertRuleData {
  id: string;
  rule_type: AlertRuleType;
  params: Record<string, unknown>;
  label: string;
  instant_email: boolean;
  enabled: boolean;
  created_at: string;
}

interface NicheOption {
  id: string;
  name: string;
}

interface CollectionOption {
  id: string;
  name: string;
}

const RULE_TYPES: { value: AlertRuleType; label: string; description: string }[] = [
  {
    value: 'phase_change',
    label: 'Un sujet passe à « C’est le moment »',
    description: 'Préviens-moi quand un sujet de cette thématique devient le bon moment pour publier.',
  },
  {
    value: 'collection_phase_change',
    label: 'Un de mes favoris change de moment',
    description: 'Préviens-moi quand un sujet mis en favori change d’étiquette (par exemple de « Ça monte » à « C’est le moment »).',
  },
  {
    value: 'video_outlier',
    label: 'Une vidéo surperforme',
    description: 'Préviens-moi quand une vidéo fait bien plus de vues que d’habitude sur sa chaîne, même petite.',
  },
  {
    value: 'window_closing',
    label: 'Un sujet se remplit vite',
    description: 'Préviens-moi quand beaucoup de vidéos de qualité sortent d’un coup sur un sujet : il risque de passer à « Trop tard ».',
  },
];

const RULE_TYPE_LABELS: Record<string, string> = {
  phase_change: 'C’est le moment',
  collection_phase_change: 'Favori',
  video_outlier: 'Surperformance',
  window_closing: 'Se remplit vite',
};

export function AlertsTab({
  rules: initialRules,
  niches,
  collections,
  isAdmin = true,
}: {
  rules: AlertRuleData[];
  niches: NicheOption[];
  collections: CollectionOption[];
  /** Le type « vidéo qui surperforme » porte sur tout le catalogue : réservé à l'administration. */
  isAdmin?: boolean;
}) {
  const ruleTypes = isAdmin ? RULE_TYPES : RULE_TYPES.filter((r) => r.value !== 'video_outlier');
  const [rules, setRules] = useState(initialRules);
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [eventsState, setEventsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [eventsAttempt, setEventsAttempt] = useState(0);
  // Deletions wait a few seconds so the toast can offer « Annuler ».
  const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // New rule form state
  const [newType, setNewType] = useState<AlertRuleType>('phase_change');
  const [newLabel, setNewLabel] = useState('');
  const [newInstant, setNewInstant] = useState(false);
  const [newNicheId, setNewNicheId] = useState('');
  const [newCollectionId, setNewCollectionId] = useState('');
  const [newMultiplier, setNewMultiplier] = useState(5);
  const [newMaxSubs, setNewMaxSubs] = useState(50000);
  const [newMinQualified, setNewMinQualified] = useState(5);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  // Load events (loading / error / ready, with a retry)
  useEffect(() => {
    let cancelled = false;
    getAlertEvents(20)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setEventsState('error');
          return;
        }
        setEvents(res.data);
        setEventsState('ready');
      })
      .catch(() => {
        if (!cancelled) setEventsState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [eventsAttempt]);

  // Flush pending deletions if the user leaves the page before the delay ends.
  useEffect(() => {
    const map = pendingDeletes.current;
    return () => {
      map.forEach((timer, id) => {
        clearTimeout(timer);
        void deleteAlertRule(id);
      });
      map.clear();
    };
  }, []);

  // Preview trigger count when form changes
  useEffect(() => {
    if (!showForm) return;
    const params = buildParams();
    previewRuleTriggerCount(newType, params).then(setPreviewCount);
  }, [showForm, newType, newNicheId, newCollectionId, newMultiplier, newMaxSubs, newMinQualified]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildParams(): Record<string, unknown> {
    switch (newType) {
      case 'phase_change':
        return { target_phase: 2, ...(newNicheId ? { niche_id: newNicheId } : {}) };
      case 'collection_phase_change':
        return newCollectionId ? { collection_id: newCollectionId } : {};
      case 'video_outlier':
        return { view_multiplier: newMultiplier, max_subscribers: newMaxSubs };
      case 'window_closing':
        return { min_qualified_72h: newMinQualified };
      default:
        return {};
    }
  }

  function handleCreate() {
    const label = newLabel.trim() || RULE_TYPES.find((r) => r.value === newType)!.label;
    startTransition(async () => {
      const result = await createAlertRule({
        rule_type: newType,
        params: buildParams(),
        label,
        instant_email: newInstant,
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Alerte créée.');
        setRules((prev) => [result.data, ...prev]);
        setShowForm(false);
        resetForm();
      }
    });
  }

  function resetForm() {
    setNewType('phase_change');
    setNewLabel('');
    setNewInstant(false);
    setNewNicheId('');
    setNewCollectionId('');
    setNewMultiplier(5);
    setNewMaxSubs(50000);
    setNewMinQualified(5);
    setPreviewCount(null);
  }

  function handleToggle(id: string, enabled: boolean) {
    startTransition(async () => {
      const result = await toggleAlertRule(id, enabled);
      if (result.error) {
        toast.error(result.error);
      } else {
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
      }
    });
  }

  function handleDelete(rule: AlertRuleData) {
    const index = rules.findIndex((r) => r.id === rule.id);
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    const restore = () =>
      setRules((prev) => {
        if (prev.some((r) => r.id === rule.id)) return prev;
        const next = [...prev];
        next.splice(Math.max(0, Math.min(index, next.length)), 0, rule);
        return next;
      });
    const timer = setTimeout(async () => {
      pendingDeletes.current.delete(rule.id);
      const result = await deleteAlertRule(rule.id);
      if (result.error) {
        toast.error(result.error);
        restore();
      }
    }, 5000);
    pendingDeletes.current.set(rule.id, timer);
    toast(`Alerte « ${rule.label} » supprimée.`, {
      duration: 5000,
      action: {
        label: 'Annuler',
        onClick: () => {
          const t = pendingDeletes.current.get(rule.id);
          if (t) clearTimeout(t);
          pendingDeletes.current.delete(rule.id);
          restore();
        },
      },
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllAlertsRead();
      toast.success('Toutes les alertes marquées comme lues.');
      setEvents((prev) => prev.map((e) => ({ ...e, read: true })));
    });
  }

  return (
    <div className="space-y-6">
      {/* Rules */}
      <section className="elev-1 rounded-xl bg-card">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold">Mes alertes</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Choisis quand recevoir un e-mail.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors cursor-pointer flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Nouvelle alerte
          </button>
        </div>

        {/* New rule form */}
        {showForm && (
          <div className="px-5 py-4 border-b border-border space-y-3">
            {/* Rule type */}
            <div>
              <label htmlFor="alert-type" className="text-[12px] font-medium text-muted-foreground">Quand me prévenir ?</label>
              <select
                id="alert-type"
                value={newType}
                onChange={(e) => setNewType(e.target.value as AlertRuleType)}
                className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
              >
                {ruleTypes.map((rt) => (
                  <option key={rt.value} value={rt.value}>{rt.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                {RULE_TYPES.find((r) => r.value === newType)?.description}
              </p>
            </div>

            {/* Type-specific params */}
            {newType === 'phase_change' && (
              <div>
                <label htmlFor="alert-niche" className="text-[12px] font-medium text-muted-foreground">Thématique (facultatif)</label>
                <select
                  id="alert-niche"
                  value={newNicheId}
                  onChange={(e) => setNewNicheId(e.target.value)}
                  className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
                >
                  <option value="">Toutes mes thématiques</option>
                  {niches.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
            )}

            {newType === 'collection_phase_change' && (
              <div>
                <label htmlFor="alert-collection" className="text-[12px] font-medium text-muted-foreground">Liste de favoris (facultatif)</label>
                <select
                  id="alert-collection"
                  value={newCollectionId}
                  onChange={(e) => setNewCollectionId(e.target.value)}
                  className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
                >
                  <option value="">Tous mes favoris</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            {newType === 'video_outlier' && (
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <label htmlFor="alert-multiplier" className="text-[12px] font-medium text-muted-foreground">Vues au moins N fois l’habitude de la chaîne</label>
                  <input
                    id="alert-multiplier"
                    type="number"
                    min={2}
                    max={50}
                    value={newMultiplier}
                    onChange={(e) => setNewMultiplier(Number(e.target.value))}
                    className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="alert-max-subs" className="text-[12px] font-medium text-muted-foreground">Chaînes de moins de N abonnés</label>
                  <input
                    id="alert-max-subs"
                    type="number"
                    min={1000}
                    step={1000}
                    value={newMaxSubs}
                    onChange={(e) => setNewMaxSubs(Number(e.target.value))}
                    className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
                  />
                </div>
              </div>
            )}

            {newType === 'window_closing' && (
              <div>
                <label htmlFor="alert-min-videos" className="text-[12px] font-medium text-muted-foreground">Au moins N vidéos de qualité en 3 jours</label>
                <input
                  id="alert-min-videos"
                  type="number"
                  min={2}
                  max={20}
                  value={newMinQualified}
                  onChange={(e) => setNewMinQualified(Number(e.target.value))}
                  className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
                />
              </div>
            )}

            {/* Label */}
            <div>
              <label htmlFor="alert-name" className="text-[12px] font-medium text-muted-foreground">Nom (facultatif)</label>
              <input
                id="alert-name"
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={RULE_TYPES.find((r) => r.value === newType)?.label}
                className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
              />
            </div>

            {/* Instant email toggle */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newInstant}
                onChange={(e) => setNewInstant(e.target.checked)}
                className="mt-0.5 rounded border-border"
              />
              <Mail className="mt-0.5 w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-[13px]">M’envoyer un e-mail tout de suite (sinon : dans le résumé du dimanche)</span>
            </label>

            {/* Preview */}
            {previewCount !== null && (
              <p className="text-[12px] text-muted-foreground italic">
                Cette alerte t’aurait prévenu {previewCount} fois le mois dernier.
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleCreate}
                disabled={isPending}
                className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                Créer
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="h-9 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Rule list */}
        <div className="divide-y divide-border">
          {rules.length === 0 && (
            <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              Aucune alerte pour l&apos;instant. Crée ta première alerte.
            </div>
          )}
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`px-5 py-3 flex items-center gap-3 ${!rule.enabled ? 'opacity-50' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                    {RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type}
                  </span>
                  <span className="text-[13px] font-medium truncate">{rule.label}</span>
                  {rule.instant_email && (
                    <span title="E-mail tout de suite"><Mail className="w-3 h-3 text-muted-foreground shrink-0" aria-label="E-mail tout de suite" /></span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(rule.id, !rule.enabled)}
                disabled={isPending}
                title={rule.enabled ? 'Suspendre' : 'Activer'}
                aria-label={rule.enabled ? `Suspendre l’alerte ${rule.label}` : `Activer l’alerte ${rule.label}`}
                className="w-10 h-10 sm:w-8 sm:h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center cursor-pointer"
              >
                {rule.enabled ? <Power className="w-3.5 h-3.5" aria-hidden="true" /> : <PowerOff className="w-3.5 h-3.5" aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(rule)}
                disabled={isPending}
                title="Supprimer"
                aria-label={`Supprimer l’alerte ${rule.label}`}
                className="w-10 h-10 sm:w-8 sm:h-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Recent events */}
      <section className="elev-1 rounded-xl bg-card">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold">Historique</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Dernières alertes déclenchées.
            </p>
          </div>
          {events.some((e) => !(e.read as boolean)) && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={isPending}
              className="h-8 px-3 rounded-md border border-border bg-card text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Tout marquer lu
            </button>
          )}
        </div>

        <div className="divide-y divide-border">
          {eventsState === 'loading' && (
            <div className="space-y-2 px-5 py-4" aria-busy="true" aria-label="Chargement de l’historique">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-5 animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}
          {eventsState === 'error' && (
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-[13px] text-muted-foreground" role="alert">
              Impossible de charger l’historique.
              <button
                type="button"
                onClick={() => {
                  setEventsState('loading');
                  setEventsAttempt((n) => n + 1);
                }}
                className="h-9 cursor-pointer rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground hover:bg-muted"
              >
                Réessayer
              </button>
            </div>
          )}
          {eventsState === 'ready' && events.length === 0 && (
            <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              Aucune alerte déclenchée pour le moment.
            </div>
          )}
          {eventsState === 'ready' && events.map((event) => {
            const ruleInfo = event.alert_rules as { label: string; rule_type: string } | undefined;
            const payload = event.payload as Record<string, unknown>;
            const read = event.read as boolean;
            const createdAt = new Date(event.created_at as string);

            return (
              <div
                key={event.id as string}
                className={`px-5 py-2.5 flex items-start gap-3 ${!read ? 'bg-primary/[0.03]' : ''}`}
              >
                <div className="mt-0.5">
                  {read ? (
                    <BellOff className="w-3.5 h-3.5 text-muted-foreground/40" />
                  ) : (
                    <Bell className="w-3.5 h-3.5 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                      {RULE_TYPE_LABELS[ruleInfo?.rule_type ?? ''] ?? ruleInfo?.rule_type}
                    </span>
                    <span className="text-[13px] font-medium truncate">
                      {ruleInfo?.label}
                    </span>
                  </div>
                  {payload.topic_label ? (
                    <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                      {String(payload.topic_label)}
                      {payload.previous_phase != null && payload.new_phase != null && (
                        <> — phase {String(payload.previous_phase)} → {String(payload.new_phase)}</>
                      )}
                    </p>
                  ) : null}
                  {payload.video_title ? (
                    <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                      {String(payload.video_title)} ({String(payload.ratio)}×)
                    </p>
                  ) : null}
                </div>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                  {createdAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
