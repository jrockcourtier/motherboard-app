# Motherboard — règles pour Claude

Motherboard est le CRM de courtier immobilier de l'utilisateur (RE/MAX L'Espace, Montréal).
App web en français, hébergée sur Vercel : https://motherboard-app-six.vercel.app
(chaque push sur `main` est déployé automatiquement). Données dans Supabase (projet `luynpgieqbszsqucldal`).

## Règles

1. Tu es autonome du début à la fin : tu modifies, tu testes, tu augmentes la version
   (`APP_VERSION` et le span `app-ver` dans `index.html`, `CACHE_NAME` dans `sw.js`),
   tu commit et tu push sur `main` toi-même.
2. Ne demande jamais à l'utilisateur de faire des manipulations techniques lui-même
   (GitHub, Vercel, Supabase, terminal, téléversement de fichiers).
3. Après chaque push, vérifie que la nouvelle version est en ligne (`sw.js` sur le site)
   avant de confirmer.
4. Si quelque chose bloque (accès, permission), dis-le en une phrase claire, avec la seule
   chose que l'utilisateur doit approuver ou cliquer.
5. Avant de commencer un travail, dis combien de temps ça va prendre et pose toutes tes
   questions d'un coup, au début.
6. Ne mets jamais de clé, de mot de passe ou de donnée de client dans le code ni dans le dépôt.
7. Réponds en français, de façon courte et simple.
