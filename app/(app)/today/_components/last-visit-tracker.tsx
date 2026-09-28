'use client';

import { useEffect } from 'react';

export function LastVisitTracker() {
  useEffect(() => {
    document.cookie = `tublyti-last-visit=${new Date().toISOString()};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
  }, []);

  return null;
}
