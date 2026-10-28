'use client';

import { useId, useState } from 'react';

/**
 * Small explanation bubble that works with mouse (hover), keyboard (focus, Escape)
 * and touch (tap to toggle). The hint text is also exposed as the trigger's description.
 */
export function InfoHint({
  hint,
  children,
  className = '',
  style,
  bubbleClassName = 'left-0',
  insideLink = false,
}: {
  hint: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  bubbleClassName?: string;
  /** Set when rendered inside a link/button: no nested control, hint read as text instead. */
  insideLink?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Escape hides the bubble even while hovered or focused (WCAG 1.4.13).
  const [dismissed, setDismissed] = useState(false);
  if (insideLink) {
    return (
      <span className={`group relative ${className}`} style={style}>
        {children}
        <span className="sr-only"> : {hint}</span>
        <span
          aria-hidden="true"
          className={`absolute bottom-full mb-1 hidden group-hover:block bg-popover text-popover-foreground text-[12px] font-normal text-left px-2 py-1 rounded shadow-md border border-border w-max max-w-[min(20rem,calc(100vw-32px))] whitespace-normal z-10 ${bubbleClassName}`}
        >
          {hint}
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-describedby={id}
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      onBlur={() => {
        setOpen(false);
        setDismissed(false);
      }}
      onMouseLeave={() => setDismissed(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setOpen(false);
          setDismissed(true);
        }
      }}
      className={`group relative cursor-help ${className}`}
      style={style}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className={`absolute bottom-full mb-1 ${open ? 'block' : 'hidden'} ${dismissed ? '' : 'group-hover:block group-focus-visible:block'} bg-popover text-popover-foreground text-[12px] font-normal text-left px-2 py-1 rounded shadow-md border border-border w-max max-w-[min(20rem,calc(100vw-32px))] whitespace-normal z-10 ${bubbleClassName}`}
      >
        {hint}
      </span>
    </button>
  );
}
