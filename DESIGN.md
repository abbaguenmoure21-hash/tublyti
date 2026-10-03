# DESIGN.md — Système de design TubLyTI (V2, clair et épuré)

Ce fichier fait autorité pour tout ce qui est visuel. Aucune couleur, taille ou ombre ne doit être écrite en dur dans un composant : on passe toujours par les tokens ci-dessous (variables CSS + classes Tailwind générées).

## Principes

1. **Une réponse en 5 secondes.** Chaque écran répond à une question (« Quel sujet je choisis cette semaine ? »). Le chiffre clé est en haut, gros, lisible.
2. **La couleur = une signification.** La couleur n'est jamais décorative. Violet = marque/action. Les 4 couleurs de phase ne servent qu'aux phases. Rouge = erreur ou saturation, jamais autre chose.
3. **Calme par défaut.** Fond presque blanc, surfaces blanches, bordures fines, une seule ombre légère. L'œil va vers les données, pas vers le décor.
4. **Instantané.** Aucun écran blanc : squelettes pendant le chargement, mises à jour optimistes, transitions ≤ 200 ms.
5. **Français correct.** Accents partout (Chaînes, Générer, Créé), typographie française (espace avant « : ? ! »), tutoiement cohérent.

## Couleurs — thème clair (défaut)

Contrastes vérifiés : texte ≥ 4,5:1 (AA), éléments graphiques ≥ 3:1.

| Token | OKLCH | Hex | Usage |
| --- | --- | --- | --- |
| `--background` | `oklch(0.985 0.003 260)` | #f9fafc | Fond de l'application |
| `--card` / `--popover` | `oklch(1 0 0)` | #ffffff | Cartes, panneaux, menus |
| `--foreground` | `oklch(0.21 0.02 265)` | #141822 | Texte principal (17,7:1) |
| `--muted-foreground` | `oklch(0.50 0.018 265)` | #5e636e | Texte secondaire (6,0:1) |
| `--muted` / `--secondary` | `oklch(0.965 0.005 265)` | #f2f3f7 | Fonds de zones, lignes survolées |
| `--border` / `--input` | `oklch(0.915 0.006 265)` | #e1e3e7 | Bordures, séparateurs |
| `--primary` | `oklch(0.52 0.21 277)` | #524fdd | Marque, boutons principaux, liens, focus (5,95:1 sur blanc) |
| `--primary-soft` | `oklch(0.95 0.035 277)` | #eaedff | Fond d'élément actif, sélection |
| `--primary-ink` | `oklch(0.45 0.19 277)` | #423ebb | Texte sur `--primary-soft` (6,9:1) |
| `--destructive` | `oklch(0.55 0.21 25)` | #d01c29 | Erreurs, suppression |
| `--success` | `oklch(0.56 0.13 155)` | #1a8a51 | Confirmation |
| `--warning` | `oklch(0.68 0.15 65)` | #d6810c | Avertissement (icônes/graphiques uniquement, jamais en texte sur blanc) |
| `--ring` | = `--primary` | | Anneau de focus clavier, 2 px, décalé de 2 px |

### Couleurs de phase (sémantiques, réservées aux phases)

Chaque phase a une couleur pleine (points du graphique, pastilles) et un couple fond doux + texte foncé pour les badges. La phase est **toujours** doublée d'un libellé ou d'une icône (daltonisme).

| Phase | Sens | Plein | Fond badge | Texte badge | Icône lucide |
| --- | --- | --- | --- | --- | --- |
| 0 · Émergence | Surveiller | `oklch(0.56 0.16 300)` #8459c3 | #f1ebff | #65389f | `Sprout` |
| 1 · Viralité courte | Ça chauffe | `oklch(0.66 0.15 65)` #cf7c00 | #fff0d7 | #8a4b00 | `Flame` |
| 2 · Fenêtre idéale | **C’est le moment** | `oklch(0.58 0.14 155)` #0e9254 | #d8f8e2 | #006337 | `Target` |
| 3 · Saturation | Trop tard | `oklch(0.58 0.19 20)` #d33949 | #ffe8e8 | #a51c30 | `Ban` |

### Échelle MGI (séquentielle, une seule teinte)

Pour les heatmaps, barres de score et mini-jauges : `#e2e6ff → #b7c0f8 → #8c97e9 → #646cd8 → #443cc6` (du plus faible au plus fort). Jamais de dégradé arc-en-ciel.

### Thème sombre (secondaire, via bouton)

Mêmes rôles, luminosités inversées : `--background oklch(0.16 0.012 265)`, `--card oklch(0.20 0.014 265)`, `--foreground oklch(0.96 0.005 265)`, `--muted-foreground oklch(0.72 0.015 265)`, `--border oklch(0.30 0.015 265)`, `--primary oklch(0.68 0.17 277)`. Les couleurs de phase gagnent +0,08 de luminosité ; les fonds de badge deviennent la couleur pleine à 18 % d'opacité.

## Typographie

- **Police** : Geist Sans (déjà installée) pour tout, Geist Mono uniquement pour les identifiants techniques. **Corriger le bug actuel** : dans `globals.css`, `--font-sans: var(--font-sans)` est circulaire → remplacer par `--font-sans: var(--font-geist-sans)`.
- **Chiffres** : toujours `tabular-nums` (classes `tabular-nums`) dans les tableaux, scores, compteurs.
- **Échelle** (rem) : 0.75 légende · 0.8125 petit · 0.875 corps UI · 1 corps lecture · 1.125 titre de carte · 1.5 titre de page · 2.25 chiffre clé (KPI). Graisses : 400 texte, 500 libellés, 600 titres et chiffres. Interlignage 1.5 texte, 1.2 titres.

## Espacements, formes, profondeur

- Grille de **4 px** : 4, 8, 12, 16, 24, 32, 48. Marge de page 24 px (16 px mobile). Écart entre cartes 16 px.
- Rayons : `--radius: 0.625rem` (10 px) pour cartes/champs ; 6 px pour badges et boutons compacts ; plein (999 px) pour pastilles.
- Une seule ombre : `0 1px 2px oklch(0.21 0.02 265 / 0.06), 0 1px 1px oklch(0.21 0.02 265 / 0.04)` sur les cartes. Popovers et menus : `0 8px 24px oklch(0.21 0.02 265 / 0.10)`. Pas de lueurs (supprimer `sidebar-glow`), pas de dégradés de fond.
- Barre latérale **claire** : fond `--card`, bordure droite `--border`, élément actif = fond `--primary-soft` + texte `--primary-ink`. Largeur 240 px, repliée 64 px, état mémorisé.

## Mouvement

- Durées : 120 ms (survol, pression), 180 ms (ouverture menu, onglet), 240 ms (panneau latéral, modale). Courbe `cubic-bezier(0.2, 0, 0, 1)`.
- On anime `opacity` et `transform` uniquement. Pas d'animation en boucle dans l'application (les formes 3D flottantes restent sur la page de connexion seulement).
- `@media (prefers-reduced-motion: reduce)` : toutes les transitions à 0 ms.

## Composants et états

- **Bouton** : primaire (plein `--primary`), secondaire (contour), fantôme (texte). Une seule action primaire visible par zone. Hauteur 36 px (32 compact). État chargement = spinner dans le bouton + libellé qui change (« Génération… »), bouton désactivé.
- **Badge de phase** : composant unique `<PhaseBadge phase={n} />` (icône + libellé + couleurs du tableau). Interdit de recoder une couleur de phase ailleurs.
- **Score MGI** : composant `<MgiScore value={n} />` = chiffre en 600 tabular + mini-jauge 48 px de l'échelle séquentielle.
- **Tableaux** : lignes de 44 px, survol `--muted`, ligne cliquable entière, en-têtes collants, tri par clic sur l'en-tête, navigation `j`/`k` + `Entrée`.
- **Toasts** (sonner) en bas à droite pour toute confirmation/erreur ; jamais `alert()`.
- **Trois états obligatoires** par bloc de données : squelette qui a la forme exacte du contenu final ; vide = illustration légère (icône lucide 32 px en `--muted-foreground`) + une phrase + une action ; erreur = phrase humaine + bouton « Réessayer ».
- **Focus clavier** visible partout (anneau `--ring`). Cibles tactiles ≥ 40 px sur mobile.

## Graphiques (Recharts)

- Matrice d'opportunités : points colorés par phase (couleurs pleines), taille = frustration, axes en `--muted-foreground` 12 px, quadrillage `--border` en pointillés, quadrant « océan bleu » teinté `--primary-soft` avec étiquette.
- Courbes de signaux : une couleur par source, prise dans une palette catégorielle **distincte des phases** : Trends `#524fdd`, vues YouTube `#0891b2`, Hacker News `#ea580c`, Stack Exchange `#64748b`. Légende cliquable pour masquer une série.
- Infobulles : fond `--popover`, ombre popover, valeurs en tabular-nums, date au format « 12 sept. ».

## Rédaction de l'interface

- Titres de page = la question à laquelle l'écran répond (« Quels sujets choisir cette semaine ? » plutôt que « Dashboard »). Ne jamais utiliser « tourner » pour parler de créer une vidéo : dire « créer », « publier » ou « choisir un sujet ».
- Boutons = verbe + objet (« Générer 5 angles », « Suivre cette chaîne »).
- Nombres : séparateur fin « 12 400 vues », pourcentages sans décimale sauf < 10 %.
- Dates relatives pour < 7 jours (« il y a 3 h »), absolues au-delà.

## Bloc `globals.css` de référence (thème clair)

```css
:root {
  --background: oklch(0.985 0.003 260);
  --foreground: oklch(0.21 0.02 265);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.21 0.02 265);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.21 0.02 265);
  --primary: oklch(0.52 0.21 277);
  --primary-foreground: oklch(0.99 0 0);
  --primary-soft: oklch(0.95 0.035 277);
  --primary-ink: oklch(0.45 0.19 277);
  --secondary: oklch(0.965 0.005 265);
  --secondary-foreground: oklch(0.21 0.02 265);
  --muted: oklch(0.965 0.005 265);
  --muted-foreground: oklch(0.50 0.018 265);
  --accent: oklch(0.95 0.035 277);
  --accent-foreground: oklch(0.45 0.19 277);
  --destructive: oklch(0.55 0.21 25);
  --success: oklch(0.56 0.13 155);
  --warning: oklch(0.68 0.15 65);
  --border: oklch(0.915 0.006 265);
  --input: oklch(0.915 0.006 265);
  --ring: oklch(0.52 0.21 277);
  --radius: 0.625rem;

  --phase-0: oklch(0.56 0.16 300);  --phase-0-soft: oklch(0.95 0.035 300);  --phase-0-ink: oklch(0.45 0.16 300);
  --phase-1: oklch(0.66 0.15 65);   --phase-1-soft: oklch(0.96 0.05 80);    --phase-1-ink: oklch(0.48 0.12 60);
  --phase-2: oklch(0.58 0.14 155);  --phase-2-soft: oklch(0.95 0.045 155);  --phase-2-ink: oklch(0.44 0.11 155);
  --phase-3: oklch(0.58 0.19 20);   --phase-3-soft: oklch(0.95 0.035 20);   --phase-3-ink: oklch(0.47 0.17 20);

  --sidebar: oklch(1 0 0);
  --sidebar-foreground: oklch(0.21 0.02 265);
  --sidebar-primary: oklch(0.52 0.21 277);
  --sidebar-primary-foreground: oklch(0.99 0 0);
  --sidebar-accent: oklch(0.95 0.035 277);
  --sidebar-accent-foreground: oklch(0.45 0.19 277);
  --sidebar-border: oklch(0.915 0.006 265);
  --sidebar-ring: oklch(0.52 0.21 277);

  --chart-1: #524fdd; --chart-2: #0891b2; --chart-3: #ea580c; --chart-4: #64748b; --chart-5: #8459c3;
}
```

Dans `@theme inline`, exposer aussi `--color-primary-soft`, `--color-primary-ink`, `--color-success`, `--color-warning` et les 12 `--color-phase-*` pour disposer des classes `bg-phase-2-soft text-phase-2-ink`, etc.

## Relief (profondeur façon Apple)

Défini dans `app/globals.css` (bloc « Profondeur façon Apple »). Ne pas créer d'autres ombres à la main.

- `elev-1` : cartes, listes, onglet actif d'un contrôle segmenté, élément actif de la barre latérale. Appliqué automatiquement à toute `bg-card` arrondie (`rounded-xl`, `rounded-2xl`) ou bordée.
- `elev-2` : barre latérale flottante, carte cliquable au survol.
- `elev-3` : panneau inspecteur, barre d'onglets mobile, fenêtres et feuilles.
- `well` : surfaces creusées (champs, pistes de contrôles segmentés, sélecteur « Afficher »).
- Bouton principal : liseré de lumière en haut + ombre teintée de la couleur primaire.
- Rayons : 9–10 px pour les boutons et lignes, 12–14 px pour les petits blocs, 17 px (`rounded-xl`) pour les cartes, 22 px pour les panneaux flottants, 24 px pour la barre mobile.
- Les panneaux flottants (barre latérale, inspecteur) sont décollés de 8 px du bord de la fenêtre.
- Interdit : ombres dures, dégradés colorés, relief sur du texte, animation d'ombre quand « réduire les animations » est actif.
