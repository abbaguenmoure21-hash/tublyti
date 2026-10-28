'use client';

import { PageError } from '@/components/tublyti/page-error';

export default function TopicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError title="On n’arrive pas à charger ce sujet." error={error} reset={reset} />;
}
