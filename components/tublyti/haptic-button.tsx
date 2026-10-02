'use client';

import { motion } from 'framer-motion';
import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'shimmer';
type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 border-transparent shadow-[0_1px_3px_rgba(10,132,255,0.3)]',
  secondary:
    'bg-[--bg-surface-2] text-foreground hover:bg-[--bg-surface-2]/80 border-[--glass-border]',
  ghost:
    'bg-transparent text-muted-foreground hover:text-foreground hover:bg-[--bg-surface-1] border-transparent',
  danger:
    'bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20',
  shimmer:
    'relative overflow-hidden bg-primary text-primary-foreground border-transparent',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'h-9 px-4 text-sm rounded-xl gap-2',
  lg: 'h-11 px-5 text-base rounded-xl gap-2.5',
};

interface HapticButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Left icon */
  icon?: React.ReactNode;
}

/**
 * HapticButton — Button with mechanical keyboard feel.
 * Compresses to scale(0.96) translateY(1px) on click with spring rebound,
 * evoking a polished physical button press.
 */
export function HapticButton({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  type = 'button',
  onClick,
  icon,
}: HapticButtonProps) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96, y: 1 }}
      transition={{
        type: 'spring',
        stiffness: 450,
        damping: 28,
        mass: 0.8,
      }}
      className={`
        inline-flex items-center justify-center
        font-semibold
        border
        transition-colors duration-150
        cursor-pointer
        disabled:opacity-50 disabled:pointer-events-none
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {/* Shimmer overlay for AI generation buttons */}
      {variant === 'shimmer' && (
        <div className="absolute inset-0 shimmer-border opacity-30 rounded-xl" />
      )}

      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </motion.button>
  );
}
