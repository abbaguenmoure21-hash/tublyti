import { Sparkles, Clapperboard, Radar, SlidersHorizontal, LifeBuoy, ShieldCheck, Rocket, type LucideIcon } from 'lucide-react';

export type SpaceKey = 'sujets' | 'preflight' | 'videos' | 'veille' | 'admin';

export interface NavSpace {
  key: SpaceKey;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Préfixes d'adresse qui appartiennent à cet espace (pour l'état actif). */
  match: string[];
}

/** Les 3 espaces client de l'app (ERGONOMIE.md). */
export const SPACES: NavSpace[] = [
  { key: 'sujets', href: '/sujets', label: 'Sujets', icon: Sparkles, match: ['/sujets', '/today', '/dashboard', '/topics', '/frustrations', '/bienvenue'] },
  { key: 'preflight', href: '/preflight', label: 'Avant de publier', icon: Rocket, match: ['/preflight'] },
  { key: 'videos', href: '/pipeline', label: 'Mes vidéos', icon: Clapperboard, match: ['/pipeline', '/my-channel', '/videos'] },
  { key: 'veille', href: '/activity', label: 'Veille', icon: Radar, match: ['/activity', '/veille'] },
];

export const SECONDARY = [
  { href: '/guide', label: 'Aide', icon: LifeBuoy, match: ['/guide'] },
  { href: '/settings', label: 'Réglages', icon: SlidersHorizontal, match: ['/settings', '/profile'] },
];

/** Console d'administration : visible uniquement pour le rôle admin. */
export const ADMIN_SPACE: NavSpace = {
  key: 'admin',
  href: '/admin',
  label: 'Console d’admin',
  icon: ShieldCheck,
  match: ['/admin', '/channels'],
};

export function isActive(pathname: string, match: string[]): boolean {
  return match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

/** Onglets affichés en haut de chaque espace (masqués quand il n'y en a qu'un). */
export const SECTION_TABS: Record<SpaceKey, { href: string; label: string; match: string[] }[]> = {
  sujets: [
    { href: '/sujets', label: 'Liste', match: ['/sujets'] },
    { href: '/dashboard', label: 'Carte', match: ['/dashboard'] },
    { href: '/frustrations', label: 'Questions du public', match: ['/frustrations'] },
  ],
  videos: [
    { href: '/pipeline', label: 'Tableau', match: ['/pipeline'] },
    { href: '/my-channel', label: 'Ma chaîne', match: ['/my-channel'] },
  ],
  preflight: [],
  veille: [{ href: '/activity', label: 'À voir cette semaine', match: ['/activity'] }],
  admin: [
    { href: '/admin', label: 'Vue d’ensemble', match: ['/admin'] },
    { href: '/admin/sujets', label: 'Sujets à valider', match: ['/admin/sujets'] },
    { href: '/admin/jobs', label: 'Collecte', match: ['/admin/jobs'] },
    { href: '/admin/coverage', label: 'Couverture et quota', match: ['/admin/coverage'] },
    { href: '/channels', label: 'Chaînes analysées', match: ['/channels'] },
    { href: '/channels/candidates', label: 'Chaînes candidates', match: ['/channels/candidates'] },
    { href: '/admin/reglages', label: 'Niches et calcul', match: ['/admin/reglages'] },
    { href: '/admin/utilisateurs', label: 'Clients', match: ['/admin/utilisateurs'] },
    { href: '/admin/attente', label: 'Liste d’attente', match: ['/admin/attente'] },
  ],
};

/** Cookie qui garde la barre latérale réduite ou ouverte (lu côté serveur, sans saut à l'affichage). */
export const SIDEBAR_COOKIE = 'tly_sidebar';
