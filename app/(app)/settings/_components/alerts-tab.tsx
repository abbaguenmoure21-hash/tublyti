'use client';

import { useState, useTransition, useEffect } from 'react';
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
    description: 'Une vidéo fait N fois la moyenne de sa chaîne, sur une chaîne de moins de K abonnés.',
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
  const [eventsLoaded, setEventsLoaded] = useState(false);

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

  // Load events
  useEffect(() => {
    if (!eventsLoaded) {
      getAlertEvents(20).then((res) => {
        setEvents(res.data);
        setEventsLoaded(true);
      });
    }
  }, [eventsLoaded]);

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
        toast.success('Règle créée.');
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

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteAlertRule(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Règle supprimée.');
        setRules((prev) => prev.filter((r) => r.id !== id));
      }
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
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)]">
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
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors cursor-pointer flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Nouvelle alerte
          </button>
        </div>

        {/* New rule form */}
        {showForm && (
          <div className="px-5 py-4 border-b border-border bg-muted/30 space-y-3">
            {/* Rule type */}
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Type</label>
              <select
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
                <label className="text-[12px] font-medium text-muted-foreground">Niche (optionnel)</label>
                <select
                  value={newNicheId}
                  onChange={(e) => setNewNicheId(e.target.value)}
                  className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
                >
                  <option value="">Toutes les niches</option>
                  {niches.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
            )}

            {newType === 'collection_phase_change' && (
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Collection (optionnel)</label>
                <select
                  value={newCollectionId}
                  onChange={(e) => setNewCollectionId(e.target.value)}
                  className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
                >
                  <option value="">Toutes les collections</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            {newType === 'video_outlier' && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[12px] font-medium text-muted-foreground">Multiplicateur min.</label>
                  <input
                    type="number"
                    min={2}
                    max={50}
                    value={newMultiplier}
                    onChange={(e) => setNewMultiplier(Number(e.target.value))}
                    className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[12px] font-medium text-muted-foreground">Abonnés max.</label>
                  <input
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
                <label className="text-[12px] font-medium text-muted-foreground">Vidéos qualifiées min. en 72 h</label>
                <input
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
              <label className="text-[12px] font-medium text-muted-foreground">Nom (optionnel)</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={RULE_TYPES.find((r) => r.value === newType)?.label}
                className="mt-1 w-full h-9 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
              />
            </div>

            {/* Instant email toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newInstant}
                onChange={(e) => setNewInstant(e.target.checked)}
                className="rounded border-border"
              />
              <Mail className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[13px]">E-mail immédiat</span>
            </label>

            {/* Preview */}
            {previewCount !== null && (
              <p className="text-[12px] text-muted-foreground italic">
                Cette règle se serait déclenchée {previewCount} fois le mois dernier.
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleCreate}
                disabled={isPending}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                Créer
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="h-8 px-3 rounded-md border border-border bg-card text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
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
                    <span title="E-mail immédiat"><Mail className="w-3 h-3 text-muted-foreground shrink-0" /></span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(rule.id, !rule.enabled)}
                disabled={isPending}
                title={rule.enabled ? 'Suspendre' : 'Activer'}
                className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center cursor-pointer"
              >
                {rule.enabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(rule.id)}
                disabled={isPending}
                className="w-7 h-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Recent events */}
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)]">
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
          {events.length === 0 && (
            <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              Aucune alerte déclenchée pour le moment.
            </div>
          )}
          {events.map((event) => {
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
