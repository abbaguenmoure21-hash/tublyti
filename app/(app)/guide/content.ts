/** Contenu de la page Aide (affiché et cherchable par GuideView). */

export const ROUTINE = [
  {
    when: 'Une seule fois · 1 minute',
    title: 'Ajoute et vérifie tes chaînes',
    text: 'Dans « Réglages », colle le lien de ta chaîne, choisis sa thématique, puis prouve qu’elle est à toi : avec Google, ou en collant le code TUBLYTI-… dans sa description. Tant qu’elle n’est pas vérifiée, aucune donnée ne s’affiche pour elle.',
    href: '/settings#chaines',
    cta: 'Ajouter mes chaînes',
  },
  {
    when: 'Le lundi · 10 minutes',
    title: 'Choisis tes sujets de la semaine',
    text: 'Ouvre « Sujets ». Clique sur un sujet marqué « C’est le moment » et « Fiable » : sa fiche s’ouvre à droite. Choisis un angle, puis « Créer cette vidéo ».',
    href: '/sujets',
    cta: 'Ouvrir Sujets',
  },
  {
    when: 'Pendant la semaine',
    title: 'Fais avancer tes vidéos',
    text: 'Dans « Mes vidéos », fais glisser chaque vidéo d’une colonne à l’autre, de l’idée à la publication.',
    href: '/pipeline',
    cta: 'Ouvrir Mes vidéos',
  },
  {
    when: 'Une semaine puis un mois après publication',
    title: 'Mesure le résultat',
    text: 'L’onglet « Ma chaîne » de Mes vidéos montre tes vues habituelles, tes vidéos qui ont décollé et, si tu connectes YouTube Analytics, tes vrais chiffres et tes revenus.',
    href: '/my-channel',
    cta: 'Ouvrir Ma chaîne',
  },
];

export const SPACES = [
  {
    name: 'Sujets',
    href: '/sujets',
    question: 'Quels sujets choisir ?',
    use: 'Ta liste de départ, classée par potentiel. Onglets : Liste, Carte (les sujets peu traités sont en haut à gauche) et Questions du public.',
  },
  {
    name: 'Mes vidéos',
    href: '/pipeline',
    question: 'Où en sont mes vidéos ?',
    use: 'Onglet Tableau pour suivre chaque vidéo de l’idée à la publication, onglet Ma chaîne pour tes statistiques, ton public et tes revenus.',
  },
  {
    name: 'Veille',
    href: '/activity',
    question: 'Que se passe-t-il dans ma niche ?',
    use: 'Les vidéos de tes thématiques à regarder cette semaine : changements de titre ou de miniature, vidéos qui surperforment.',
  },
  {
    name: 'Réglages',
    href: '/settings',
    question: 'Comment configurer mon compte ?',
    use: 'Tes chaînes et leur vérification, les thématiques que tu suis sans chaîne, tes alertes e-mail et ton jeton de connexion à Claude.',
  },
];

export const FEASIBILITY = [
  { grade: 'A', cls: 'bg-success/15 text-success', title: 'Terrain libre', text: 'Aucune bonne vidéo concurrente, ou la plupart viennent de chaînes de ta taille ou plus petites. Fonce.' },
  { grade: 'B', cls: 'bg-phase-2/15 text-phase-2-ink', title: 'Très jouable', text: 'Une bonne partie des vidéos qui marchent viennent de chaînes plus petites que la tienne.' },
  { grade: 'C', cls: 'bg-muted text-muted-foreground', title: 'Compétition mixte', text: 'Des chaînes de toutes tailles se partagent le sujet. Jouable avec un angle bien différent.' },
  { grade: 'D', cls: 'bg-warning/15 text-warning', title: 'Difficile', text: 'La plupart des bonnes vidéos viennent de chaînes plus grosses que la tienne.' },
  { grade: 'E', cls: 'bg-destructive/15 text-destructive', title: 'Très difficile', text: 'Presque toutes les vidéos viennent de chaînes beaucoup plus grosses (environ 5 à 20 fois ta taille).' },
  { grade: 'F', cls: 'bg-destructive/15 text-destructive', title: 'Hors de portée pour l’instant', text: 'Écart extrême : les chaînes en place ont plus de 20 fois tes abonnés. Garde le sujet pour plus tard.' },
];

export const POTENTIAL = [
  { range: '80 à 100', label: 'Très fort' },
  { range: '60 à 79', label: 'Fort' },
  { range: '40 à 59', label: 'Moyen' },
  { range: '20 à 39', label: 'Faible' },
  { range: '0 à 19', label: 'Très faible' },
];

export const OUTLIERS = [
  { badge: '1,5× à 3×', text: 'Fait mieux que d’habitude : le sujet plaît un peu plus que la moyenne de la chaîne.' },
  { badge: '3× à 5×', text: 'Nette surperformance : le sujet ou l’angle a trouvé un public.' },
  { badge: '5× à 10×', text: 'Forte surperformance : à étudier de près (titre, miniature, angle).' },
  { badge: '10×+', text: 'Exceptionnel : au moins 10 fois plus de vues que d’habitude.' },
];

export const LABELS = [
  { name: 'Personne ne traite', text: 'Le commentaire dit que personne n’explique ce point, ou pas correctement.' },
  { name: 'Souhait de vidéo', text: 'Le public demande explicitement une vidéo sur ce sujet.' },
  { name: 'Trop court', text: 'La vidéo s’arrête trop tôt : le public voulait aller plus loin.' },
  { name: 'Longue recherche', text: 'La personne a longtemps cherché cette information sans la trouver.' },
];

export const FAQ = [
  {
    q: 'Pourquoi un sujet n’a pas de lettre de faisabilité ?',
    a: 'La lettre compare ta chaîne aux chaînes déjà présentes sur le sujet. Il faut une chaîne vérifiée dans la thématique du sujet et son nombre d’abonnés (mis à jour chaque nuit). Sans chaîne, la lettre est remplacée par un lien vers Réglages.',
  },
  {
    q: 'Pourquoi « Pas encore mesuré · N vidéos repérées » ?',
    a: 'Le potentiel se calcule à partir de 5 vidéos. En dessous, le sujet est suivi : chaque nuit, TubLyTI lui cherche des vidéos. Un sujet resté sous 5 vidéos pendant 21 jours est fermé.',
  },
  {
    q: 'Quand les chiffres changent-ils ?',
    a: 'Chaque nuit, la collecte part vers 3 h (heure du Cameroun) et se termine vers 4 h 30 : nouvelles vidéos, vues, commentaires, potentiel. Les chiffres de YouTube Analytics (page Ma chaîne) ont environ 2 jours de retard, comme dans YouTube Studio.',
  },
  {
    q: 'Une chaîne n’affiche aucune donnée, pourquoi ?',
    a: 'Elle n’est pas encore vérifiée. Ouvre Réglages › Mes chaînes et termine la vérification (Google ou code dans la description). Si la chaîne vient d’être ajoutée, ses vidéos arrivent après la prochaine collecte.',
  },
  {
    q: 'Les revenus estimés sont-ils fiables ?',
    a: 'L’estimation multiplie les vues de tes vidéos longues par le RPM habituel de ta thématique : c’est un ordre de grandeur. Seuls les revenus de YouTube Analytics (si ta chaîne est monétisée et connectée) sont tes vrais chiffres.',
  },
  {
    q: 'Que fait TubLyTI de mon accès YouTube Analytics ?',
    a: 'Il lit tes statistiques en lecture seule, ne publie et ne modifie rien. Le jeton est chiffré et le bouton « Déconnecter » de Ma chaîne le supprime. Détails dans la page Confidentialité.',
  },
];

export const SHORTCUTS = [
  ['⌘K', 'Rechercher partout'],
  ['/', 'Chercher un sujet dans la liste'],
  ['J / K', 'Sujet suivant / précédent'],
  ['Entrée', 'Ouvrir le premier sujet'],
  ['C', 'Créer la vidéo du sujet ouvert'],
  ['X', 'Ignorer le sujet ouvert'],
  ['Échap', 'Fermer le panneau'],
];

export const PHASES = [
  { phase: 2, name: 'C’est le moment', text: 'Le public demande et peu de bonnes vidéos existent. Crée ta vidéo maintenant.' },
  { phase: 1, name: 'Ça monte', text: 'L’intérêt grimpe vite. Garde le sujet de côté et surveille-le.' },
  { phase: 0, name: 'À surveiller', text: 'Le sujet commence à apparaître. Tu es prévenu s’il prend de l’ampleur.' },
  { phase: 3, name: 'Trop tard', text: 'Beaucoup de bonnes vidéos existent déjà. Choisis un autre sujet ou un angle très différent.' },
];

export const TERMS = [
  { term: 'Potentiel (0 à 100)', def: 'L’intérêt d’un sujet comparé aux autres sujets de ta niche. 100 = le plus intéressant en ce moment.' },
  { term: 'Fiabilité', def: 'La quantité de données derrière le potentiel. « Fiable » : beaucoup de vidéos et de commentaires analysés. « Peu de données » : à prendre avec prudence.' },
  { term: 'Questions du public', def: 'Les commentaires qui réclament une vidéo, signalent une explication manquante ou une vidéo trop courte.' },
  { term: 'Vidéo qui surperforme', def: 'Une vidéo qui fait plus de vues que d’habitude pour sa chaîne : comparée à la médiane de ses 10 vidéos précédentes, au même âge quand c’est possible. Le chiffre (1,5×, 3×, 10×+) dit combien de fois plus.' },
  { term: 'Bonne vidéo (concurrente)', def: 'Une vidéo de plus de 8 minutes, publiée par une chaîne d’au moins 10 000 abonnés, dont les vues dépassent 20 % des abonnés de la chaîne. Ce sont elles qui comptent comme « offre » sur un sujet.' },
  { term: 'Carte', def: 'Chaque point est un sujet. En hauteur : la demande du public. En largeur : le nombre de bonnes vidéos déjà publiées. En haut à gauche : beaucoup de demande, peu d’offre, les meilleures opportunités.' },
  { term: 'Faisabilité (A à F)', def: 'Tes chances de te faire une place sur le sujet, selon la taille de ta chaîne face aux chaînes déjà présentes. Voir le détail plus haut.' },
  { term: 'Vues habituelles', def: 'La médiane des vues de tes vidéos longues : la moitié de tes vidéos font plus, l’autre moitié moins. Plus juste qu’une moyenne, qu’une seule vidéo virale fausse.' },
  { term: 'RPM / CPM', def: 'RPM : ce que tu touches pour 1 000 vues. CPM : ce que paient les annonceurs pour 1 000 affichages de pub (avant la part de YouTube).' },
  { term: 'Chaîne vérifiée', def: 'Une chaîne dont tu as prouvé qu’elle est à toi (Google ou code dans la description). Seules les chaînes vérifiées donnent accès aux données.' },
  { term: 'Sujet sensible', def: 'Un sujet délicat (santé mentale grave, par exemple). Il reste visible mais n’apparaît jamais dans tes recommandations.' },
  { term: 'Favoris', def: 'Clique sur l’étoile d’un sujet pour le garder sous la main. Tes favoris ne sont visibles que par toi.' },
  { term: 'Alertes', def: 'Dans Réglages, choisis quand recevoir un e-mail : un sujet qui devient le bon moment, un favori qui change, un sujet qui se remplit vite.' },
  { term: 'Niche créée automatiquement', def: 'Quand plusieurs chaînes semblables ne correspondent à aucune thématique existante, TubLyTI en crée une. Tu peux la suivre comme les autres.' },
  { term: 'Connexion à Claude', def: 'Un jeton d’accès (Réglages) permet de poser tes questions à Claude : tes sujets, les questions du public, mais aussi les statistiques de ta chaîne, tes revenus et la rétention de tes vidéos (si YouTube Analytics est connecté). Il ne donne accès qu’à tes chaînes, en lecture seule pour tes statistiques.' },
  { term: 'Afficher (barre latérale)', def: 'Choisis une de tes chaînes pour ne voir que ses sujets, partout dans l’app. « Toutes mes chaînes » pour tout voir.' },
];
