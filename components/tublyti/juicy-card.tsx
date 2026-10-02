'use client';

import React, { useRef, useCallback } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

interface JuicyCardProps {
  children: React.ReactNode;
  className?: string;
  /** Disable tilt effect (e.g. on mobile or reduced-motion) */
  disableTilt?: boolean;
  /** Max rotation in degrees (default ±4.5) */
  tiltDeg?: number;
  /** Click handler */
  onClick?: () => void;
}

/**
 * JuicyCard — 3D interactive card with tilt physics and specular cursor glow.
 * Inspired by JuicySMS tactile design: perspective 1200px, spring-damped rotation,
 * radial gradient highlight following the cursor.
 */
export function JuicyCard({
  children,
  className = '',
  disableTilt = false,
  tiltDeg = 4.5,
  onClick,
}: JuicyCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Raw mouse position (0–1 range, centered at 0.5)
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Specular highlight position (CSS percentage)
  const glowX = useMotionValue(50);
  const glowY = useMotionValue(50);

  // Spring-smoothed values for tilt
  const springConfig = { stiffness: 300, damping: 30, mass: 0.8 };
  const springX = useSpring(mouseX, springConfig);
  const springY = useSpring(mouseY, springConfig);

  // Map to rotation
  const rotateX = useTransform(springY, [-0.5, 0.5], [`${tiltDeg}deg`, `-${tiltDeg}deg`]);
  const rotateY = useTransform(springX, [-0.5, 0.5], [`-${tiltDeg}deg`, `${tiltDeg}deg`]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disableTilt || !cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      mouseX.set(x - 0.5);
      mouseY.set(y - 0.5);
      glowX.set(x * 100);
      glowY.set(y * 100);
    },
    [disableTilt, mouseX, mouseY, glowX, glowY]
  );

  const handleMouseLeave = useCallback(() => {
    mouseX.set(0);
    mouseY.set(0);
    glowX.set(50);
    glowY.set(50);
  }, [mouseX, mouseY, glowX, glowY]);

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      style={{
        rotateX: disableTilt ? 0 : rotateX,
        rotateY: disableTilt ? 0 : rotateY,
        transformStyle: 'preserve-3d',
        perspective: '1200px',
      }}
      whileHover={{ scale: 1.012 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={`
        group relative
        rounded-[24px] border border-[--glass-border]
        bg-[--bg-surface-1]
        backdrop-blur-2xl
        p-6
        shadow-[0_2px_12px_-2px_var(--glass-shadow)]
        transition-colors duration-200
        hover:border-[--glass-border-highlight]
        ${onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      {/* Specular highlight layer — follows cursor */}
      <motion.div
        className="pointer-events-none absolute -inset-px rounded-[24px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: useTransform(
            [glowX, glowY],
            ([x, y]) =>
              `radial-gradient(400px circle at ${x}% ${y}%, rgba(255,255,255,0.06), transparent 80%)`
          ),
        }}
      />

      {/* Chanfrein lumineux — top edge highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[24px] bg-gradient-to-r from-transparent via-[--glass-border-highlight] to-transparent opacity-60" />

      {children}
    </motion.div>
  );
}
