# Motherboard — Julien Rock, courtier immobilier

App web (PWA) : agenda Google (Gmail + ReMax), ajout de rendez-vous, CRM contacts.
En ligne : https://motherboard-app-six.vercel.app

## Configuration (Vercel > Settings > Environments > Production)
| Variable | Rôle |
|---|---|
| `GOOGLE_CLIENT_SECRET` | Code secret du client OAuth Google (GOCSPX-…) |
| `COOKIE_SECRET` | Clé de chiffrement de la session |
| `SUPABASE_SECRET_KEY` | Clé secrète Supabase (sb_secret_…) pour le CRM |
| `SUPABASE_URL` | Optionnel (par défaut le projet Motherboard) |
| `ALLOWED_EMAILS` | Optionnel (par défaut jrockcourtier@gmail.com) |

Base de données : exécuter `supabase.sql` une fois dans Supabase > SQL Editor.

## Fichiers
- `index.html` — app (agenda, vues Jour/Semaine/Mois, ajout de RDV)
- `crm.js`, `crm.css` — CRM (contacts, notes, suivis), local d'abord puis synchro
- `api/` — fonctions serveur Vercel (connexion Google permanente, contacts)
- `sw.js` — mises à jour automatiques / hors ligne
