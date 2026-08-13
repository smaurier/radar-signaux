# Déploiement — GitHub Actions (cron gratuit, sans VPS)

Le radar tournait initialement en **best-effort local** : `@nestjs/schedule` ne se
déclenche que tant que le process Node reste vivant, donc poste éteint = journée
zappée, sans rattrapage. Le 12/08, passage à une exécution planifiée par **GitHub
Actions**, gratuite et illimitée sur un repo public, sans les inconvénients d'un VPS
(facturation, maintenance OS, sécurisation d'un serveur exposé).

## Pourquoi GitHub Actions n'est pas un détournement

`on: schedule:` est une fonctionnalité officielle et documentée de GitHub Actions,
pas un contournement d'un outil pensé uniquement pour la CI/CD — au même titre que
`on: push:` ou `on: workflow_dispatch:`. Ce qui serait un vrai détournement : essayer
d'y faire tourner un serveur HTTP permanent (timeout de 6h max par run, aucune garantie
de continuité entre deux runs). Ici, le radar est justement conçu pour tourner en
**run-once séquentiel** (`src/cron/run-once.ts`) : chaque run est une exécution isolée
qui démarre, traite toute la séquence, persiste l'état, puis s'arrête — exactement le
modèle d'exécution que GitHub Actions sait bien faire.

## Architecture

Deux repos séparés, sur le même principe que celui déjà utilisé pour la mémoire privée
de Sylvain (repo de code public + repo de données privé) :

- **`smaurier/radar-signaux`** (public) — le code du moteur, ce repo.
- **`smaurier/radar-signaux-data`** (privé) — contient uniquement `radar.sqlite`, le
  seul état qui doit survivre entre deux runs (déduplication BODACC, prospects a11y
  déjà traités, etc.). Jamais de secret dedans, juste la base.

Séquence à chaque run planifié (`.github/workflows/cron.yml`) :

1. Checkout du code (`radar-signaux`).
2. Checkout des données (`radar-signaux-data`, via un token dédié).
3. Récupération de `radar.sqlite` du run précédent (s'il existe) dans `data/`.
4. Installation des dépendances + Chromium (Playwright).
5. **Build** (`npm run build`) — voir piège ci-dessous, c'est l'étape qui a cassé la
   première tentative.
6. Exécution séquentielle de toute la chaîne (`node dist/cron/run-once.js`) : BODACC →
   enrichissement NAF → qualification INPI → presse → lecture d'actes → digest mode Dev
   → pipeline a11y → digest a11y. Chaque étape est indépendamment tolérante à l'échec
   (une étape qui plante n'interrompt pas les suivantes).
7. Commit + push de `radar.sqlite` mis à jour vers `radar-signaux-data`.

Planifié à 7h Paris (`cron: '0 7 * * *'` + `timezone: Europe/Paris`, champ disponible
depuis 03/2026 — évite le calcul manuel UTC/CEST). `workflow_dispatch` permet aussi un
déclenchement manuel pour tester sans attendre le planning.

## Piège réel rencontré : `tsx` casse l'injection de dépendances NestJS

Le tout premier essai lançait le script avec `npx tsx src/cron/run-once.ts` (cohérent
avec `npm run mcp`, qui utilise `tsx` pour le serveur MCP). Résultat : **toutes** les
dépendances injectées par constructeur devenaient `undefined` — `this.storage`,
`this.entreprisesService`, etc. — sans qu'aucune erreur ne remonte au démarrage. Le
plantage n'arrivait qu'au moment d'utiliser la dépendance (`Cannot read properties of
undefined`), une par une, à chaque étape de la séquence.

**Cause** : `tsx` (basé sur esbuild) n'émet pas de façon fiable les métadonnées de
décorateurs (`emitDecoratorMetadata`) dont NestJS a besoin pour résoudre l'injection de
dépendances par réflexion. Ça ne s'était jamais vu ailleurs dans ce projet parce que le
serveur MCP (`src/mcp/server.ts`) n'utilise volontairement pas le conteneur NestJS — il
instancie ses services à la main, sans dépendances de constructeur à résoudre.

**Fix** : build officiel (`nest build`, le même pipeline que `start:prod`) suivi d'une
exécution du JS compilé avec `node` simple. Vérifié en local avant de toucher au
workflow : `npm run build && node dist/cron/run-once.js` a traité 1411 signaux BODACC
réels sans aucune dépendance manquante. Le workflow buide donc explicitement avant
d'exécuter (`npm run build` puis `node dist/cron/run-once.js`) — jamais `tsx` pour ce
point d'entrée.

## Secrets requis (Settings → Secrets and variables → Actions, sur `radar-signaux`)

| Secret | Rôle | Source |
|---|---|---|
| `DATA_REPO_TOKEN` | Push vers `radar-signaux-data` | PAT fine-grained, scope contents read/write sur ce seul repo — **à créer manuellement par Sylvain**, ne peut pas être généré depuis une session non interactive |
| `GMAIL_USER` | Digest email | déjà poussé depuis `.env` local |
| `GMAIL_APP_PASSWORD` | Digest email (mot de passe d'application, pas le mot de passe du compte) | déjà poussé depuis `.env` local |
| `RADAR_NOTIFY_TO` | Destinataire du digest | déjà poussé depuis `.env` local |
| `INPI_USERNAME` / `INPI_PASSWORD` | Login API RNE (qualification capital + actes) | déjà poussé depuis `.env` local |

### Créer le PAT pour `DATA_REPO_TOKEN`

1. https://github.com/settings/personal-access-tokens/new
2. **Resource owner** : `smaurier`. **Repository access** : Only select repositories →
   `radar-signaux-data` uniquement (jamais un token tous-repos pour ça).
3. **Permissions** → Repository permissions → **Contents : Read and write** (seule
   permission nécessaire — pas besoin d'Issues, Actions, etc.).
4. Expiration : au choix (90 jours minimum recommandé, à renouveler ensuite — un PAT
   fine-grained ne peut pas être "no expiration" indéfiniment sans org).
5. Générer, copier le token, puis :
   ```bash
   gh secret set DATA_REPO_TOKEN -b"<token copié>" -R smaurier/radar-signaux
   ```

## Limites assumées

- Pas de garantie de timing exact (`schedule` GitHub peut décaler jusqu'à ~15 min lors
  des pics de charge de la plateforme) — sans impact ici, le radar travaille sur des
  fenêtres glissantes (7 derniers jours BODACC, dédup) donc un décalage n'efface jamais
  un signal.
- Un repo public inactif 60 jours voit ses workflows planifiés automatiquement
  désactivés par GitHub — pas un risque concret tant que le projet est actif, mais à
  surveiller si le radar est mis en pause longtemps.
- Le PAT `DATA_REPO_TOKEN` expire et doit être renouvelé manuellement (pas
  d'automatisation possible pour cette étape par nature).
