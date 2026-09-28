'use client';

import { useEffect, useTransition } from 'react';
import { toast } from 'sonner';
import { markTopicProduction } from '@/lib/actions/topics';
import { generateAngles } from '@/lib/actions/angles';

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.getAttribute('cmdk-input') !== null) return true;
  return false;
}

export function TopicShortcuts({
  topicId,
  status,
  hasBrief,
}: {
  topicId: string;
  status: string;
  hasBrief: boolean;
}) {
  const [, startTransition] = useTransition();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isInputFocused()) return;

      if (e.key === 'a') {
        e.preventDefault();
        startTransition(async () => {
          const result = await generateAngles(topicId);
          if (result.error) {
            toast.error(result.error);
          } else {
            toast.success('Angles générés.');
          }
        });
        return;
      }

      if (e.key === 'p' && status === 'active') {
        e.preventDefault();
        startTransition(async () => {
          const result = await markTopicProduction(topicId);
          if (result.error) {
            toast.error(result.error);
          } else {
            toast.success('Sujet marqué en production.');
          }
        });
        return;
      }

      if (e.key === 'c' && hasBrief) {
        e.preventDefault();
        // Trigger click on the first "Copier le brief" button on the page
        const btn = document.querySelector<HTMLButtonElement>('[data-action="copy-brief"]');
        if (btn) btn.click();
        return;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [topicId, status, hasBrief, startTransition]);

  return null;
}
