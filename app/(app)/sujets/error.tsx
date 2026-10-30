'use client';

import { PageError } from '@/components/tublyti/page-error';

export default function SujetsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError title="On n’arrive pas à charger tes sujets." error={error} reset={reset} />;
}
