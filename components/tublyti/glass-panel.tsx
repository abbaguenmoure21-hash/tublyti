import React from 'react';

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  /** Use smaller radius and blur */
  compact?: boolean;
  as?: 'div' | 'section' | 'aside' | 'nav' | 'header';
}

/**
 * GlassPanel — Apple frosted glass material component.
 * Implements the spec's Ultra-Thin glass: blur(24px) saturate(180%),
 * with chanfrein lumineux (inset top border highlight).
 */
export function GlassPanel({
  children,
  className = '',
  compact = false,
  as: Component = 'div',
}: GlassPanelProps) {
  return (
    <Component
      className={`${compact ? 'glass-panel-sm' : 'glass-panel'} ${className}`}
    >
      {children}
    </Component>
  );
}
