'use client';

import { motion } from 'framer-motion';
import { useMemo } from 'react';

interface SparklineChartProps {
  data: number[];
  /** Width of the chart (default: 80) */
  width?: number;
  /** Height of the chart (default: 24) */
  height?: number;
  /** Stroke color (default: currentColor) */
  color?: string;
  /** Show area fill under the line */
  showFill?: boolean;
  /** Animate on mount */
  animate?: boolean;
  className?: string;
}

/**
 * SparklineChart — Inline mini trend chart for embedding in cards and tables.
 * Renders an SVG path from data points with optional gradient fill.
 */
export function SparklineChart({
  data,
  width = 80,
  height = 24,
  color = 'currentColor',
  showFill = true,
  animate = true,
  className = '',
}: SparklineChartProps) {
  const path = useMemo(() => {
    if (!data || data.length < 2) return '';

    const padding = 2;
    const w = width - padding * 2;
    const h = height - padding * 2;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data.map((val, i) => ({
      x: padding + (i / (data.length - 1)) * w,
      y: padding + h - ((val - min) / range) * h,
    }));

    // Build smooth curve using catmull-rom to cubic bezier conversion
    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }

    return d;
  }, [data, width, height]);

  const fillPath = useMemo(() => {
    if (!path) return '';
    const lastPoint = data.length > 0 ? width - 2 : 0;
    return `${path} L ${lastPoint},${height - 2} L 2,${height - 2} Z`;
  }, [path, data, width, height]);

  if (!data || data.length < 2) {
    return (
      <div
        className={`flex items-center justify-center text-muted-foreground/30 ${className}`}
        style={{ width, height }}
      >
        <span className="text-[9px]">—</span>
      </div>
    );
  }

  // Unique gradient ID
  const gradientId = useMemo(() => `spark-grad-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ overflow: 'visible' }}
    >
      {showFill && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}

      {showFill && fillPath && (
        <motion.path
          d={fillPath}
          fill={`url(#${gradientId})`}
          initial={animate ? { opacity: 0 } : undefined}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        />
      )}

      <motion.path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0 } : undefined}
        animate={{ pathLength: 1 }}
        transition={{
          duration: 0.8,
          ease: [0.22, 1, 0.36, 1],
        }}
      />
    </svg>
  );
}
