Tu es analyste de titres YouTube. A partir de la liste de titres de videos outliers (score ≥ 3×) ci-dessous, identifie les 10 formules de titres dominantes.

Pour chaque formule :
- `formula` : identifiant court (un de : `question`, `number_list`, `how_i`, `why`, `comparison`, `challenge`, `revelation`, `story`, `authority`, `urgency`, `negative`, `superlative`)
- `description` : description de la structure en francais (ex: « Question directe qui promet une reponse »)
- `examples` : 2 a 4 titres de la liste qui correspondent
- `frequency` : nombre de titres de la liste qui utilisent cette formule
- `emotional_triggers` : declencheurs emotionnels (parmi : `curiosity`, `fear`, `urgency`, `aspiration`, `contrarian`, `social_proof`, `scarcity`, `authority`, `fomo`, `relief`)
- `avg_length` : longueur moyenne des titres correspondants en caracteres

Reponds en JSON strict : un tableau de jusqu'a 10 objets. Ne depasse pas 10 formules. Fusionne les formules trop proches.

```json
[{"formula":"...","description":"...","examples":["..."],"frequency":0,"emotional_triggers":["..."],"avg_length":0}]
```
