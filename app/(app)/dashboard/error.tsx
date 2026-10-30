'use client';

import { PageError } from '@/components/tublyti/page-error';

export default function CarteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError title="On n’arrive pas à charger la carte des sujets." error={error} reset={reset} />;
}
