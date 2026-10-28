'use client';

import { motion, useSpring, useMotionValue } from 'framer-motion';
import { useEffect, useState } from 'react';

interface QuotaDialProps {
  /** Current usage (0 to max) */
  current: number;
  /** Max quota (default: 10000) */
  max?: number;
  /** Soft limit warning threshold */
  softLimit?: number;
  /** Size in px (default: 48 for mini, 160 for full) */
  size?: number;
  /** Show as mini gauge (for sidebar) */
  mini?: boolean;
  /** Label text */
  label?: string;
  className?: string;
}

function getQuotaColor(ratio: number): string {
  if (ratio <= 0.5) return '#30D158';    // Green
  if (ratio <= 0.8) return '#FF9F0A';    // Amber
  return '#FF453A';                       // Red
}

/**
 * QuotaDial — Apple Watch-style circular quota gauge.
 * Shows YouTube API quota consumption with color-coded segments:
 * Green (0-50%), Amber (50-80%), Red (80-100%).
 */
export function QuotaDial({
  current,
  max = 10000,
  softLimit = 8000,
  size = 48,
  mini = false,
  label = 'Quota YT',
  className = '',
}: QuotaDialProps) {
  const ratio = Math.min(current / max, 1);
  const color = getQuotaColor(ratio);

  const strokeWidth = mini ? 3 : 8;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - ratio * circumference;

  // Animated value
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 100, damping: 30 });
  const [display, setDisplay] = useState(0);

  useEffect(() => { mv.set(current); }, [current, mv]);
  useEffect(() => {
    const unsub = spring.on('change', (v) => setDisplay(Math.round(v)));
    return unsub;
  }, [spring]);

  if (mini) {
    return (
      <div className={`flex items-center gap-2 ${className}`} title={`${label}: ${current} / ${max}`} role="img" aria-label={`${label} : ${current.toLocaleString('fr-FR')} sur ${max.toLocaleString('fr-FR')}`}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--bg-surface-2, rgba(255,255,255,0.08))"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="flex flex-col">
          <span className="text-[11px] text-muted-foreground leading-tight">{label}</span>
          <span className="text-[11px] font-medium text-mono-metric tabular-nums" style={{ color }}>
            {Math.round(ratio * 100)}%
          </span>
        </div>
      </div>
    );
  }

  // Full-size gauge
  return (
    <div className={`relative inline-flex flex-col items-center gap-3 ${className}`} role="img" aria-label={`${label} : ${current.toLocaleString('fr-FR')} sur ${max.toLocaleString('fr-FR')}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--bg-surface-2, rgba(255,255,255,0.08))"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Soft limit marker */}
          {softLimit < max && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--text-muted, #48484A)"
              strokeWidth={1}
              strokeDasharray={`${(softLimit / max) * circumference} ${circumference}`}
              strokeLinecap="round"
              opacity={0.4}
            />
          )}

          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ filter: `drop-shadow(0 0 8px ${color}40)` }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-mono-metric font-bold leading-none"
            style={{ fontSize: size * 0.18, color }}
          >
            {display.toLocaleString('fr-FR')}
          </span>
          <span className="text-muted-foreground text-[10px] mt-1">/ {max.toLocaleString('fr-FR')}</span>
        </div>
      </div>

      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
