
import { ShieldAlert } from 'lucide-react';

/**
 * Badge displayed on sensitive topics (non-monetizable / brand-risky).
 * These topics are excluded from tops and digest but remain visible in full lists.
 */
export function SensitiveBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: 'var(--phase-4-soft, hsl(0 60% 95%))',
        color: 'var(--phase-4-ink, hsl(0 60% 40%))',
      }}
      title="Sujet sensible — exclu des recommandations et du digest"
    >
      <ShieldAlert className="h-3 w-3" />
      Sensible
    </span>
  );
}
