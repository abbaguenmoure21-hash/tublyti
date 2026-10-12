import type { Metadata } from 'next';
import { GuideView } from './guide-view';

export const metadata: Metadata = { title: 'Aide' };

/** Centre d'aide : recherche, sommaire, guide pas à pas, lexique et questions fréquentes. */
export default function GuidePage() {
  return <GuideView />;
}
