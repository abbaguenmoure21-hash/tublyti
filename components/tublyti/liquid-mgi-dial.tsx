'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useSpring, useTransform, useMotionValue } from 'framer-motion';

function getGaugeColor(value: number): string {
  if (value >= 80) return '#30D158'; // Emerald — excellent
  if (value >= 60) return '#0A84FF'; // Electric Blue — good
  if (value >= 40) return '#FF9F0A'; // Amber — moderate
  return '#FF453A'; // Coral — low
}

function getGaugeLabel(value: number): string {
  if (value >= 80) return 'Exceptionnel';
  if (value >= 60) return 'Solide';
  if (value >= 40) return 'Modéré';
  return 'Faible';
}

interface LiquidMgiDialProps {
  value: number;
  /** Size of the dial in px (default: 140) */
  size?: number;
  /** Show the label below the score */
  showLabel?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * LiquidMgiDial — Animated circular gauge inspired by Apple Watch dials and JuicySMS
 * fluid gauges. Uses spring-animated SVG arcs with an odometer-style counter.
 */
export function LiquidMgiDial({
  value,
  size = 140,
  showLabel = true,
  className = '',
}: LiquidMgiDialProps) {
  const clampedValue = Math.min(Math.max(value, 0), 100);
  const color = getGaugeColor(clampedValue);
  const label = getGaugeLabel(clampedValue);

  // SVG dimensions
  const strokeWidth = 8;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clampedValue / 100) * circumference;

  // Animated counter
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, {
    stiffness: 100,
    damping: 30,
    mass: 1,
  });
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    motionValue.set(clampedValue);
  }, [clampedValue, motionValue]);

  useEffect(() => {
    const unsubscribe = springValue.on('change', (latest) => {
      setDisplayValue(Math.round(latest));
    });
    return unsubscribe;
  }, [springValue]);

  return (
    <div className={`relative inline-flex flex-col items-center gap-2 ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
        >
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--bg-surface-2, rgba(255,255,255,0.08))"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Animated gauge arc */}
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
            transition={{
              duration: 1.2,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{
              filter: `drop-shadow(0 0 6px ${color}40)`,
            }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-mono-metric text-display-giant leading-none"
            style={{ fontSize: size * 0.28, color }}
          >
            {displayValue}
          </span>
          <span
            className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mt-0.5"
          >
            MGI
          </span>
        </div>
      </div>

      {showLabel && (
        <span
          className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
          style={{
            backgroundColor: `${color}20`,
            color,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
