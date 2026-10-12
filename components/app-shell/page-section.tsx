import Link from 'next/link';
import { Bell, BookOpen, CircleHelp, Compass, Gauge, Keyboard, LetterText, MessageSquareQuote, Palette, Rocket, Sparkles, TrendingUp, Tv, User, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  bell: Bell,
  book: BookOpen,
  help: CircleHelp,
  compass: Compass,
  gauge: Gauge,
  keyboard: Keyboard,
  letters: LetterText,
  quote: MessageSquareQuote,
  palette: Palette,
  rocket: Rocket,
  sparkles: Sparkles,
  trend: TrendingUp,
  tv: Tv,
  user: User,
};

/**
 * Section d'une page longue (Réglages, Aide) : pastille d'icône, titre, une phrase d'explication,
 * lien d'aide facultatif, puis le contenu. Ancre utilisable par le sommaire (SectionNav).
 */
export function PageSection({
  id,
  icon,
  title,
  description,
  helpHref,
  children,
}: {
  id: string;
  icon?: string;
  title: string;
  description?: React.ReactNode;
  helpHref?: string;
  children: React.ReactNode;
}) {
  const Icon = icon ? ICONS[icon] : null;
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex scroll-mt-20 flex-col gap-4 lg:scroll-mt-8">
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="elev-1 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id={`${id}-titre`} className="text-[20px] font-semibold tracking-[-0.01em]">
              {title}
            </h2>
            {helpHref && (
              <Link href={helpHref} className="shrink-0 text-[13px] font-medium text-primary hover:underline">
                Comment ça marche ?
              </Link>
            )}
          </div>
          {description && <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>}
        </div>
      </div>
      {children}
    </section>
  );
}
