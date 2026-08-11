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
curl -X POST http://localhost:3000/bodacc/run     # déclenche une collecte immédiate
curl -X POST http://localhost:3000/presse/run      # tente de confirmer les signaux via la presse
curl http://localhost:3000/bodacc/signaux          # liste les signaux stockés (avec statut presse)
```

### Configuration (variables d'environnement, toutes optionnelles)

| Variable | Défaut | Rôle |
|---|---|---|
| `BODACC_REGION_CODE` | `84` (Auvergne-Rhône-Alpes) | Code région BODACC à surveiller |
| `BODACC_LOOKBACK_DAYS` | `7` | Fenêtre de recherche glissante (jours) |
| `RADAR_DB_PATH` | `./data/radar.sqlite` | Emplacement de la base locale |
| `PORT` | `3000` | Port HTTP |

## Comment ça marche (mode Dev)

1. **Détection** — appel quotidien à l'API BODACC (gratuite, sans clé) : filtre les avis
   de type « Modifications diverses » contenant le mot « capital » sur la région
   configurée, sur la fenêtre glissante.
2. **Déduplication** — chaque signal (SIREN + date de parution) est stocké en local ;
   seuls les signaux inédits remontent d'un run à l'autre.
3. **Confirmation presse** — les signaux pas encore confirmés sont comparés (matching de
   nom d'entreprise, normalisé et purgé des formes juridiques SAS/SARL/SCI/etc.) aux flux
   RSS Maddyness et FrenchWeb. Un match ajoute la source, l'URL et le titre de l'article
   sur le signal.
4. **Limite connue et constatée** — depuis le guichet unique (2023), le descriptif BODACC
   ne précise plus le sens (hausse/baisse) ni le montant de la modification de capital.
   Ce collecteur produit donc des **candidats à qualifier**, pas des levées confirmées.
   En pratique, sur un run réel en région AURA, la quasi-totalité des candidats sont des
   PME/TPE locales (SCI, commerces, professions libérales) que la presse tech nationale
   ne couvre jamais — la confirmation presse ne lève donc qu'une minorité de cas.
   **L'étape de qualification INPI (lire le nouveau capital, ne garder que les vraies
   hausses) est le vrai filtre utile, pas encore implémentée** — voir Roadmap.

## Roadmap

- [x] Confirmation presse (RSS Maddyness / FrenchWeb, matching par nom d'entreprise)
- [ ] Qualification INPI (nouveau capital vs ancien, ne garder que les hausses
      significatives) — **le vrai filtre utile**, cf limite ci-dessus
- [ ] Notifications par email (Gmail SMTP) au lieu de l'endpoint de lecture seule
- [ ] Mode Freelance a11y (scanner de déclaration d'accessibilité RGAA/EAA)
- [ ] Serveur MCP en lecture seule (`get_signals`, `search_company`) pour interroger le
      radar depuis un autre outil

## Étude de faisabilité

Le détail des sources testées (BODACC, INPI, Pappers, flux RSS) et l'analyse juridique du
mode Freelance a11y sont documentés dans un repo privé séparé (non inclus ici, car il
contient des éléments de stratégie personnelle).
