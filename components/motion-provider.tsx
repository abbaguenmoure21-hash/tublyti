'use client';

import { MotionConfig } from 'framer-motion';

/** Makes every framer-motion animation honour the OS "reduce motion" setting. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
