'use client';

import { useTheme } from 'next-themes';
import { useMounted } from '@/hooks/use-mounted';

const OPTIONS = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
  { value: 'system', label: 'Comme le système' },
];

export function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = mounted ? theme ?? 'system' : 'system';

  return (
    <div role="radiogroup" aria-label="Thème" className="inline-flex gap-0.5 self-start rounded-[10px] bg-muted p-[3px]">
      {OPTIONS.map((o) => {
        const on = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(o.value)}
            className={`flex h-8 items-center rounded-[8px] px-3.5 text-[13px] transition-all ${
              on ? 'bg-card font-semibold shadow-[0_1px_2px_rgba(20,24,34,0.12)]' : 'font-medium text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
