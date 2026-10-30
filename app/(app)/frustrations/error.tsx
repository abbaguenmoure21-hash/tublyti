'use client';

import { PageError } from '@/components/tublyti/page-error';

export default function QuestionsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError title="On n’arrive pas à charger les questions du public." error={error} reset={reset} />;
}
