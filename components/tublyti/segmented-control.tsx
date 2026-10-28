'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Accessible name of the group. */
  ariaLabel?: string;
}

/**
 * SegmentedControl — Apple-style segmented control with elastic pill slider.
 * The luminous capsule pill moves with squash-and-stretch physics
 * during transitions between segments.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
  ariaLabel,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0 });

  const updatePill = useCallback(() => {
    if (!containerRef.current) return;
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const buttons = containerRef.current.querySelectorAll<HTMLButtonElement>('[data-segment]');
    const btn = buttons[idx];
    if (!btn) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setPillStyle({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
  }, [options, value]);

  useEffect(() => {
    updatePill();
    window.addEventListener('resize', updatePill);
    return () => window.removeEventListener('resize', updatePill);
  }, [updatePill]);

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const idx = options.findIndex((o) => o.value === value);
        const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        const next = (idx + step + options.length) % options.length;
        onChange(options[next].value);
        containerRef.current?.querySelectorAll<HTMLButtonElement>('[data-segment]')[next]?.focus();
      }}
      className={`
        relative inline-flex items-center gap-0.5
        p-[3px]
        rounded-xl
        bg-[--bg-surface-1]
        border border-[--glass-border]
        ${className}
      `}
    >
      {/* Animated pill */}
      <motion.div
        aria-hidden="true"
        className="absolute top-[3px] bottom-[3px] rounded-[10px] bg-[--bg-surface-2] shadow-[0_1px_3px_rgba(0,0,0,0.15)] border border-[--glass-border-highlight]"
        initial={false}
        animate={{
          left: pillStyle.left,
          width: pillStyle.width,
        }}
        transition={{
          type: 'spring',
          stiffness: 450,
          damping: 28,
          mass: 0.8,
        }}
      />

      {options.map((option) => (
        <button
          key={option.value}
          data-segment
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          className={`
            relative z-10 flex items-center gap-1.5
            px-4 py-1.5
            rounded-[10px]
            text-sm font-medium
            transition-colors duration-150
            cursor-pointer
            ${
              value === option.value
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/80'
            }
          `}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
