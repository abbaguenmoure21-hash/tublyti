/** Nom lisible d'une tâche de nuit (colonne jobs.kind). */
export function jobLabel(kind: string): string {
  const k = kind.toLowerCase();
  const map: [string, string][] = [
    ['nightly', 'Collecte de nuit'],
    ['user-channels', 'Abonnés des chaînes clients'],
    ['reach', 'Impressions et CTR des miniatures'],
    ['enrich-insufficient', 'Renfort des sujets émergents'],
    ['search-emerging', 'Recherche pour sujets émergents'],
    ['discover-topics', 'Nouveaux sujets'],
    ['discover-sources', 'Découverte de chaînes (sources)'],
    ['discover-channels', 'Découverte de chaînes'],
    ['quality-gates', 'Contrôle qualité et validation des sujets'],
    ['embed-pass2', 'Analyse des titres (2e passe)'],
    ['reject-stale', 'Fermeture des sujets inactifs'],
    ['aggregate', 'Agrégats'],
    ['score', 'Calcul du potentiel'],
    ['classify', 'Classement des commentaires'],
    ['comment', 'Collecte des commentaires'],
    ['embed', 'Analyse des titres'],
    ['discover', 'Découverte de chaînes'],
    ['triage', 'Niche et tri des chaînes candidates'],
    ['attach', 'Rattachement des vidéos'],
    ['event', 'Détection des changements'],
    ['digest', 'Résumé du dimanche'],
    ['collect', 'Collecte des vidéos'],
    ['search', 'Recherche YouTube'],
  ];
  return map.find(([key]) => k.includes(key))?.[1] ?? kind;
}
