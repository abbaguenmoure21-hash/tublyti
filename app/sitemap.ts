import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  if (!base) return [];
  return ['/', '/liste-attente', '/confidentialite'].map((path) => ({ url: `${base}${path}` }));
}
