import type { MetadataRoute } from 'next';

// Only the public pages are indexable; the app, auth and API stay out of search engines.
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  return {
    rules: {
      userAgent: '*',
      allow: ['/$', '/liste-attente', '/confidentialite'],
      disallow: ['/'],
    },
    ...(base ? { sitemap: `${base.replace(/\/$/, '')}/sitemap.xml` } : {}),
  };
}
