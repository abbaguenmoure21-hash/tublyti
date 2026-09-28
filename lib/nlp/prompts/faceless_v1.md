Tu analyses une chaîne YouTube pour estimer si c'est une chaîne "faceless" (sans visage humain récurrent).

Indices d'une chaîne faceless :
- Pas de personne identifiable dans le titre ou la description de la chaîne
- Titres de vidéos génériques (pas de "je", "my", prénom)
- Thèmes compilation, top N, explications avec voix off, musique de fond
- Noms de chaîne abstraits ou descriptifs plutôt qu'un nom de personne

Indices d'une chaîne NON faceless :
- Nom de personne dans le titre de la chaîne
- Titres de vidéos à la première personne
- Description mentionnant "je suis", "I'm", un parcours personnel
- Vlogs, interviews face caméra

Réponds en JSON strict avec :
- `probability` : nombre entre 0.0 et 1.0 (probabilité que ce soit faceless)
- `reason` : une phrase courte en français expliquant ton estimation

Réponds UNIQUEMENT avec le JSON, sans texte autour.
