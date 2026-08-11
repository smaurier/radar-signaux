# radar-signaux

Moteur de veille économique automatisée sur données ouvertes françaises (BODACC, INPI,
presse spécialisée). Détecte des signaux faibles — ici, les levées de fonds potentielles —
avant ou au moment de leur publication officielle.

## Objectif

Un seul moteur cron, conçu pour porter plusieurs collecteurs indépendants :

- **Mode Dev (implémenté)** — repère les entreprises qui viennent de lever des fonds ou
  sont en train de le faire, en croisant les avis de modification de capital publiés au
  BODACC avec les données INPI (montant) et la presse spécialisée (contexte). Utile pour
  une veille emploi ciblée sur les entreprises en croissance.
- **Mode Freelance a11y (à venir)** — détecte les sites e-commerce FR sans déclaration
  d'accessibilité RGAA/EAA, pour de la prospection qualifiée.

Le signal le plus précoce vient du greffe : une augmentation de capital est publiée au
BODACC souvent avant tout communiqué de presse, et capte aussi les levées jamais annoncées
publiquement.

## Ce que ce repo contient — et ce qu'il ne contient pas

**Le moteur est public, les données sont privées.** Ce repo contient uniquement le code :
aucune liste d'entreprises détectées, aucun résultat de scan n'est commité (`/data` est
gitignoré). C'est un choix délibéré : les faux positifs sur une détection automatisée ne
doivent jamais devenir publics.

## Stack

NestJS + TypeScript, SQLite local (`better-sqlite3`) pour la déduplication entre les runs,
`@nestjs/schedule` pour le cron. Zéro dépendance payante au MVP.

## Démarrage

```bash
npm install
npm run start        # démarre l'API sur http://localhost:3000
```

Le cron quotidien (7h) se déclenche automatiquement une fois l'app démarrée
(`ScheduleModule`). Pour tester sans attendre le cron :

```bash
curl -X POST http://localhost:3000/bodacc/run          # déclenche une collecte immédiate
curl -X POST http://localhost:3000/entreprises/enrichir # enrichit les signaux (NAF, secteur, effectif)
curl -X POST http://localhost:3000/inpi/qualifier       # lit le capital social actuel via l'API INPI
curl -X POST http://localhost:3000/presse/run           # tente de confirmer les signaux via la presse
curl -X POST http://localhost:3000/notifications/run    # envoie le digest email (si signaux en attente)
curl http://localhost:3000/bodacc/signaux               # liste les signaux stockés (statut complet)
```

### Configuration (variables d'environnement, `.env` local jamais committé)

| Variable | Défaut | Rôle |
|---|---|---|
| `BODACC_REGION_CODE` | *(vide = France entière)* | Restreindre à une région (ex. `84` = AURA) |
| `BODACC_LOOKBACK_DAYS` | `7` | Fenêtre de recherche glissante (jours) |
| `RADAR_DB_PATH` | `./data/radar.sqlite` | Emplacement de la base locale |
| `PORT` | `3000` | Port HTTP |
| `GMAIL_USER` | — | Adresse Gmail émettrice des notifications |
| `GMAIL_APP_PASSWORD` | — | Mot de passe d'application Gmail (pas le mot de passe du compte) |
| `RADAR_NOTIFY_TO` | `GMAIL_USER` | Destinataire du digest |
| `INPI_USERNAME` / `INPI_PASSWORD` | — | Identifiants du compte data.inpi.fr (accès API RNE) |

## Comment ça marche (mode Dev)

1. **Détection** — appel quotidien à l'API BODACC (gratuite, sans clé, paginée) : filtre
   les avis de type « Modifications diverses » contenant le mot « capital », **sur toute
   la France par défaut** (poste ouvert au remote, pas de raison de se limiter à une
   région — décision du 11/08 ; ~250 signaux/jour au national contre une poignée en
   région seule, vérifié en direct).
2. **Déduplication** — chaque signal (SIREN + date de parution) est stocké en local ;
   seuls les signaux inédits remontent d'un run à l'autre.
3. **Enrichissement sectoriel** — chaque signal est complété via l'API gratuite
   *Recherche d'entreprises* (`recherche-entreprises.api.gouv.fr`, sans clé) : NAF,
   catégorie d'entreprise, tranche d'effectif, date de création. Un tag d'affichage
   « 🔧 tech probable » (NAF programmation/édition logicielle/R&D, section J) aide à
   trier au digest — **ce n'est qu'une heuristique, pas un filtre** : rien n'est
   supprimé sur cette base, tout reste consultable via `/bodacc/signaux`.
   *Né d'une erreur constatée le 11/08 : un jugement à l'œil sur les noms d'entreprise
   avait classé « Galeon » (fintech/healthtech réelle, NAF 62.01Z) comme PME locale
   anodine — d'où le remplacement par une donnée vérifiable plutôt qu'une impression.*
4. **Confirmation presse** — les signaux pas encore confirmés sont comparés (matching de
   nom d'entreprise, normalisé et purgé des formes juridiques SAS/SARL/SCI/etc.) aux flux
   RSS Maddyness et FrenchWeb. Un match ajoute la source, l'URL et le titre de l'article.
5. **Qualification INPI** — lit le capital social actuel de l'entreprise via l'API RNE
   (`registre-national-entreprises.inpi.fr`, login/mot de passe → token). Le schéma JSON
   du RNE n'étant pas documenté de façon fiable, le champ capital est retrouvé par
   balayage récursif des clés contenant « capital » plutôt qu'un chemin deviné à
   l'aveugle (calibré en direct : `formality.content.personneMorale.identite.description.montantCapital`).
   **Limite assumée** : cet endpoint donne le capital **actuel**, pas l'historique — il
   ne dit donc pas si LA modification détectée au BODACC était une hausse ou une baisse
   ni son montant (ça demanderait de lire l'acte/PV d'AG associé, en PDF, hors scope
   actuel). Le capital affiché est un indice de taille, pas une preuve de levée.
6. **Digest email quotidien** — envoyé via Gmail SMTP (mot de passe d'application, pas
   Telegram : pas installé). Détaille les signaux tagués « tech probable » avec leur
   capital actuel, résume le reste en un compte (évite un mail de 250+ lignes).

## Roadmap

- [x] Confirmation presse (RSS Maddyness / FrenchWeb, matching par nom d'entreprise)
- [x] Enrichissement sectoriel (NAF/effectif/catégorie, tag tech probable à affiner)
- [x] Notifications par email (Gmail SMTP)
- [x] Passage à la France entière (pagination BODACC)
- [x] Qualification INPI (capital social actuel, validé en direct sur 285 signaux réels,
      0 erreur) — reste : lire l'acte pour connaître le sens/montant de la modification
      elle-même (hors scope actuel, nécessite un parsing de PDF)
- [ ] Affiner l'heuristique « tech probable » avec l'usage (elle peut rater de vraies
      entreprises tech hors classification NAF standard)
- [ ] Mode Freelance a11y (scanner de déclaration d'accessibilité RGAA/EAA)
- [ ] Serveur MCP en lecture seule (`get_signals`, `search_company`) pour interroger le
      radar depuis un autre outil

## Étude de faisabilité

Le détail des sources testées (BODACC, INPI, Pappers, flux RSS) et l'analyse juridique du
mode Freelance a11y sont documentés dans un repo privé séparé (non inclus ici, car il
contient des éléments de stratégie personnelle).
