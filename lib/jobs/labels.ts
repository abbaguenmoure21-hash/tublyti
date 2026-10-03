/** Nom lisible d'une tâche de nuit (colonne jobs.kind). */
export function jobLabel(kind: string): string {
  const k = kind.toLowerCase();
  const map: [string, string][] = [
    ['nightly', 'Collecte de nuit'],
    ['score', 'Calcul du potentiel'],
    ['classify', 'Classement des commentaires'],
    ['comment', 'Collecte des commentaires'],
    ['embed', 'Regroupement en sujets'],
    ['discover', 'Découverte de chaînes'],
    ['triage', 'Tri des chaînes candidates'],
    ['attach', 'Rattachement des vidéos'],
    ['event', 'Détection des changements'],
    ['digest', 'Résumé du dimanche'],
    ['collect', 'Collecte des vidéos'],
  ];
  return map.find(([key]) => k.includes(key))?.[1] ?? kind;
}
