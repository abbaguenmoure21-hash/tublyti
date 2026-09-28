'use client';

import {
  Dialog as DialogPrimitive,
} from '@base-ui/react/dialog';

const SHORTCUT_SECTIONS = [
  {
    title: 'Navigation globale',
    items: [
      { keys: ['g', 't'], label: "Aujourd'hui" },
      { keys: ['g', 'm'], label: 'Matrice' },
      { keys: ['g', 'p'], label: 'Pipeline' },
      { keys: ['g', 'f'], label: 'Frustrations' },
    ],
  },
  {
    title: 'Actions globales',
    items: [
      { keys: ['⌘', 'K'], label: 'Ouvrir la palette de commandes' },
      { keys: ['/'], label: 'Rechercher' },
      { keys: ['?'], label: 'Afficher les raccourcis' },
    ],
  },
  {
    title: 'Page Sujet',
    items: [
      { keys: ['a'], label: 'Générer des angles' },
      { keys: ['p'], label: 'Passer en production' },
      { keys: ['c'], label: 'Copier le brief' },
    ],
  },
] as const;

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-50 bg-black/20 supports-backdrop-filter:backdrop-blur-xs transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
        />
        <DialogPrimitive.Popup
          className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(440px,calc(100vw-32px))] bg-popover border border-border rounded-xl shadow-[0_8px_24px_rgba(20,24,34,0.10)] transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95"
        >
          <div className="px-5 pt-4 pb-2">
            <DialogPrimitive.Title className="text-[15px] font-semibold text-foreground">
              Raccourcis clavier
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[12px] text-muted-foreground mt-0.5">
              Désactivés quand le focus est dans un champ de saisie.
            </DialogPrimitive.Description>
          </div>

          <div className="px-5 pb-5 space-y-4">
            {SHORTCUT_SECTIONS.map((section) => (
              <div key={section.title}>
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {section.title}
                </h3>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between py-1.5"
                    >
                      <span className="text-[13px] text-foreground">{item.label}</span>
                      <div className="flex items-center gap-1">
                        {item.keys.map((k, i) => (
                          <span key={i}>
                            <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-border bg-muted/50 px-1.5 text-[11px] font-mono text-muted-foreground">
                              {k}
                            </kbd>
                            {i < item.keys.length - 1 && (
                              <span className="text-[10px] text-muted-foreground mx-0.5">puis</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
