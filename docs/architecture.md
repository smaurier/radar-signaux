# Architecture — radar-signaux

Vue d'ensemble du code, à lire quand le README pose la question *« comment
c'est fait à l'intérieur ? »* plutôt que *« qu'est-ce que ça fait ? »*. Le
README couvre le quoi et le pourquoi. Ce document couvre la structure.

Le déploiement (GitHub Actions, run-once en CI, PAT, secrets) a son propre
document dédié : [`deploiement-github-actions.md`](deploiement-github-actions.md).
Ce fichier-ci ne le duplique pas — il s'y renvoie quand pertinent.

## Vue à 30 000 pieds

```
                          ┌──────────────────────────┐
                          │  APIs & sources externes │
                          │  BODACC · INPI RNE · NAF │
                          │  RSS presse · CrUX FR    │
                          │  Sites e-commerce FR     │
                          └────────────┬─────────────┘
                                       │
                     ┌─────────────────┴──────────────────┐
                     │                                    │
              ┌──────▼──────┐                    ┌────────▼─────────┐
              │  Mode Dev   │                    │ Mode Freelance   │
              │  (levées)   │                    │  a11y (Nuada)    │
              │             │                    │                  │
              │ 7 étapes    │                    │ 7 étapes         │
              │ 7h00→7h30   │                    │ 7h45→8h00        │
              └──────┬──────┘                    └────────┬─────────┘
                     │                                    │
                     └──────────────┬─────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │ SQLite unique      │
                          │ data/radar.sqlite  │
                          │ 2 tables :         │
                          │ - bodacc_signaux   │
                          │ - a11y_prospects   │
                          └─────────┬──────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     │                             │
              ┌──────▼──────┐              ┌───────▼─────────┐
              │ Digest mail │              │ Serveur MCP     │
              │ Gmail SMTP  │              │ stdio, RO       │
              │ (2 modes)   │              │ 4 tools         │
              └─────────────┘              └─────────────────┘
```

Deux collecteurs indépendants, un stockage partagé (fichier SQLite unique,
tables séparées), deux sorties (digest email + serveur MCP en lecture seule).

## Points d'entrée

Il y en a **trois** — c'est délibéré, chacun sert un contexte différent :

| Entry point | Fichier | Contexte | Notes |
|---|---|---|---|
| `nest start` (serveur HTTP) | `src/main.ts` | Dev/debug local | Toutes les routes REST exposées (`/bodacc/*`, `/a11y/*`, etc.). Crons `@nestjs/schedule` actifs tant que le process tourne. |
| `node dist/cron/run-once.js` | `src/cron/run-once.ts` | Production CI (GitHub Actions) | Pas de serveur HTTP, pas de `ScheduleModule`. Exécute la séquence complète *séquentiellement* puis quitte. Voir `deploiement-github-actions.md` pour le pourquoi. |
| `npm run mcp` | `src/mcp/server.ts` | Serveur MCP standalone | Volontairement hors DI Nest — instancie ses services à la main, lit le SQLite en readonly. Autonome par rapport au reste de l'app. |

## Modules NestJS

Chaque module est enregistré dans `src/app.module.ts`. Les 2 modes vivent
dans des arborescences séparées (`src/bodacc/` + `src/inpi/` + `src/presse/`
+ `src/notifications/` pour le mode Dev ; `src/a11y/` pour le mode a11y),
sans dépendance croisée entre eux.

### Mode Dev (levées de fonds)

Un module par étape du pipeline, chacun avec son `Service` (logique) et son
`Controller` (route REST pour test manuel).

| Module | Rôle | Cron `@nestjs/schedule` | Storage |
|---|---|---|---|
| `bodacc` | Étape 1 : collecte les modifications de capital via l'API BODACC opendata | 7h00 (`EVERY_DAY_AT_7AM`) | `bodacc_signaux` (insert) |
| `entreprises` | Étape 2 : enrichissement NAF via `recherche-entreprises.api.gouv.fr` | 7h05 | update |
| `inpi` | Étapes 3 et 4 : qualification capital + lecture d'actes PDF via l'API RNE | 7h10 (capital) + 7h20 (actes) | update |
| `presse` | Étape 5 : confirmation via RSS Maddyness + FrenchWeb | 7h15 | update |
| `notifications` | Étape 6 : digest email Gmail SMTP | 7h30 | flag `notifie_email` |

`storage/storage.service.ts` centralise l'accès à la table `bodacc_signaux`
(voir schéma plus bas). Chaque étape ajoute ses colonnes en migration
additive — pas de nouvelle table par étape.

### Mode Freelance a11y (prospection Nuada)

Un seul module (`a11y`) qui regroupe 7 étapes internes. La granularité
sous-module est plus fine que le mode Dev parce que la logique est plus
riche (chaque étape a plusieurs stratégies : fetch simple → chemins usuels
→ navigateur headless).

| Sous-module `a11y/*` | Rôle | Notes |
|---|---|---|
| `domaines/` | Étape 1 : sourcing CrUX top-lists FR | Repli sur mois précédents si le fichier du mois courant n'existe pas encore |
| `entreprises/mentions-legales.*` | Étape 2 : extraction du SIREN depuis les mentions légales du site | Regex RCS/SIREN, joker anti-encodage |
| `entreprises/qualification.*` | Étape 3 : CA/effectif via `recherche-entreprises.api.gouv.fr` | Seuils EAA code conso (>10 salariés ET >2 M€ CA). Garde-fou de cohérence nom/domaine (statut `suspect`). |
| `declaration/` | Étape 4 : détection de la déclaration RGAA | Deux formulations reconnues (normalisée + narrative « le site X est non conforme au RGAA »). Suivi de lien découvert + chemins usuels + rendu navigateur. |
| `scan/` | Étape 5 : scan `@axe-core/playwright` | Réservé aux prospects qualifiés + non conformes/absents (coût 5-15s). Top 5 violations triées par gravité. |
| `argumentaire/` | Base factuelle juridique (pas un email prêt) | Bascule automatique de régime selon le CA réel (EAA code conso <250 M€ vs art. 47/Arcom ≥250 M€). Reproduit sinon l'erreur du TJ de Lille 05-06/05/2026. |
| `notifications/` | Digest email a11y | Réutilise le service Gmail SMTP du mode Dev via variables d'env communes |
| `pipeline/` | Orchestrateur : enchaîne 2→5 pour un domaine, arrêt anticipé | Ne recalcule jamais un domaine déjà en base |

Trois services transverses (utilisés par plusieurs étapes du mode a11y) :

- `robots.service.ts` — vérifie `robots.txt` avant tout fetch. Absence ou
  inaccessibilité = autorisé par défaut (RFC 9309). Un `Disallow` est traité
  comme un blocage anti-bot (statut distinct, jamais confondu avec « rien
  trouvé »).
- `page-fetcher.service.ts` — fetch HTTP standard + décodage charset
  (`response.text()` force UTF-8 quel que soit l'encodage réel, cause de
  mojibake sur les vieux sites — corrigé en lisant le buffer brut +
  `Content-Type`/`<meta charset>` + `TextDecoder` adapté).
- `navigateur.service.ts` — repli Playwright/Chromium quand le fetch simple
  reçoit un HTTP 403 (fingerprinting TLS/HTTP, ~40 % des sites e-commerce
  FR bloquent le fetch Node). Déclenché sur blocage uniquement, jamais sur
  simple timeout.

`storage/a11y-storage.service.ts` gère la table `a11y_prospects` (voir
schéma plus bas). Même fichier SQLite que le mode Dev, table dédiée — les
deux modes ne partagent aucune donnée, juste le fichier physique.

### Serveur MCP (indépendant du reste)

`src/mcp/server.ts` est un script standalone, pas un module NestJS.

Pourquoi hors DI Nest : le protocole MCP attend un process léger lancé à la
demande par le client, pas un serveur HTTP persistant. Charger tout le
conteneur Nest ajouterait plusieurs centaines de ms au démarrage pour rien.
Seul `ArgumentaireService` est réutilisé (aucune dépendance injectée réelle
malgré le décorateur `@Injectable`).

Lit le SQLite en `readonly: true` (Better-SQLite3) — impossible d'écrire par
construction, même en cas de bug.

4 tools exposés, tous en lecture seule :

| Tool | Table lue |
|---|---|
| `get_signals` | `bodacc_signaux` (les plus récents) |
| `get_leads` | `a11y_prospects` (statut qualifié + déclaration absente/non conforme/partielle) |
| `search_company` | `bodacc_signaux` + `a11y_prospects` (recherche par nom/SIREN/domaine) |
| `get_argumentaire` | `a11y_prospects` (un domaine) → passe par `ArgumentaireService` pour générer la base factuelle |

Transport `stdio` (pas HTTP+token) : pas de serveur permanent à sécuriser.
À reconsidérer seulement si le radar doit être interrogé depuis autre chose
qu'une session locale (ex. routine cloud) — pas le cas aujourd'hui.

## Schéma SQLite

Un seul fichier `data/radar.sqlite` (chemin configurable via
`RADAR_DB_PATH`). Deux tables indépendantes, une par mode.

### `bodacc_signaux` (mode Dev)

Clé primaire composite `(siren, date_parution)` — c'est ce qui fait la
déduplication au run suivant (le même SIREN peut avoir plusieurs annonces
BODACC à des dates différentes, ce sont bien des signaux distincts).

Colonnes ajoutées en **migration additive** au fil des étapes (SQLite n'a
pas de `ADD COLUMN IF NOT EXISTS` — on inspecte `PRAGMA table_info` avant
chaque `ALTER TABLE`). C'est ce qui permet d'ajouter une étape sans casser
une base existante.

| Groupe | Colonnes | Étape qui les remplit |
|---|---|---|
| Identité BODACC (obligatoire) | `siren`, `date_parution`, `region_code`, `descriptif_brut`, `commercant`, `tribunal`, `first_seen_at` | `bodacc` (insert) |
| Confirmation presse | `presse_confirmee`, `presse_source`, `presse_url`, `presse_titre` | `presse` |
| Enrichissement NAF | `enrichi`, `naf_code`, `section_activite`, `categorie_entreprise`, `tranche_effectif`, `date_creation` | `entreprises` |
| Qualification INPI (capital actuel) | `inpi_qualifie`, `inpi_capital`, `inpi_erreur` | `inpi.service` |
| Lecture d'actes (sens/montant réels) | `acte_lu`, `acte_sens`, `acte_capital_avant`, `acte_capital_apres`, `acte_id`, `acte_erreur` | `inpi-actes.service` |
| Digest email | `notifie_email` | `notifications` |

Chaque étape 2+ a sa méthode `listUnXxx()` sur `StorageService` qui remonte
les signaux pas encore passés par elle (`WHERE inpi_qualifie = 0`, etc.).
Idempotent : rejouer une étape ne re-traite pas ce qui l'a déjà été.

### `a11y_prospects` (mode Freelance a11y)

Clé primaire `domaine` (un domaine = un prospect au plus). `ON CONFLICT DO
UPDATE` : rejouer le pipeline sur un domaine met à jour ses données, ne
crée pas de doublon.

| Groupe | Colonnes | Étape qui les remplit |
|---|---|---|
| Identité | `domaine`, `etape_atteinte`, `traite_le` | `pipeline` (insert/update) |
| Extraction SIREN | `siren`, `statut_siren`, `source_url_siren` | `mentions-legales` |
| Qualification | `nom_complet`, `naf_code`, `categorie_entreprise`, `tranche_effectif`, `ca`, `annee_ca`, `coherent_avec_domaine`, `statut_qualification` | `qualification` |
| Déclaration RGAA | `statut_declaration`, `source_url_declaration` | `declaration` |
| Scan axe-core | `scan_total_violations`, `scan_top_violations` (JSON stringifié) | `scan` |
| Digest email | `notifie_email` | `a11y-notifications` |

`etape_atteinte` mémorise jusqu'où le pipeline est allé — utile pour
comprendre pourquoi un domaine n'a pas de scan (arrêté avant, statut
`sous_seuil` par exemple). Voir la docstring de `PipelineService` pour la
liste exacte des règles d'arrêt.

## Flux d'exécution : `run-once.ts` vs `@Cron` local

Les deux points d'entrée exécutent la **même logique métier**, mais dans
deux modèles d'exécution différents.

**En dev local (`nest start`)** : `ScheduleModule.forRoot()` monté dans
`app.module.ts` déclenche les `@Cron` à leur créneau (7h00, 7h05, 7h10,
7h15, 7h20, 7h30, 7h45, 8h00). Chaque cron est un déclencheur indépendant
sur des créneaux horaires fixes. **Requiert que le process Node vive** —
poste éteint = journée zappée sans rattrapage.

**En prod CI (`node dist/cron/run-once.js`)** : `NestFactory.createApplicationContext`
construit le conteneur DI mais ne démarre pas de serveur HTTP. La séquence
est exécutée *séquentiellement dans le même process*, chaque étape appelle
`service.run()` directement, l'étape N+1 ne démarre jamais avant que N soit
terminée. **Corrige par construction le risque de chevauchement trouvé le
11/08 en process persistant** (sur un gros volume BODACC, l'étape 1 pouvait
déborder sur le créneau 7h05 et bloquer l'étape 2).

Une étape en échec dans `run-once.ts` n'interrompt pas les suivantes (log
d'erreur + on continue) — cohérent avec la tolérance à l'échec appliquée
partout ailleurs (jamais bloquer tout un run pour un signal isolé).

Le point d'entrée `run-once.ts` **ne dépend pas de `ScheduleModule`** —
c'est le workflow GitHub Actions qui joue le rôle de scheduler
(`cron: '0 7 * * *'` + `timezone: Europe/Paris`). Les décorateurs `@Cron`
sur les services restent utiles en dev local mais sont inertes en CI (le
process quitte avant qu'un créneau ne se déclenche).

## Sources externes utilisées

Toutes gratuites, aucune payante au MVP.

| Source | Auth | Utilisée par |
|---|---|---|
| BODACC opendata (`bodacc-datadila.opendatasoft.com`) | Aucune (quota anonyme suffisant) | `bodacc` |
| API Recherche d'entreprises (`recherche-entreprises.api.gouv.fr`) | Aucune | `entreprises` (mode Dev) + `a11y/qualification` |
| API RNE INPI (`registre-national-entreprises.inpi.fr`) | login/mot de passe → token | `inpi.service` + `inpi-actes.service` |
| RSS Maddyness | Aucune | `presse` |
| RSS FrenchWeb | Aucune | `presse` |
| CrUX top-lists FR (`github.com/zakird/crux-top-lists`) | Aucune | `a11y/domaines` |
| Sites e-commerce FR (mentions légales, déclaration accessibilité) | — (fetch anonyme, repli Playwright sur 403) | `a11y/mentions-legales` + `a11y/declaration` + `a11y/scan` |
| Gmail SMTP | mot de passe d'application | `notifications` + `a11y-notifications` |

Aucune de ces sources n'a de secret partagé — les crédentiels INPI et Gmail
vivent dans `.env` local (dev) ou en secrets GitHub Actions (CI). Voir
[`deploiement-github-actions.md`](deploiement-github-actions.md) pour la
liste exacte des secrets requis.

## Décisions d'architecture — pourquoi c'est comme ça

Les vraies décisions structurantes, avec ce qu'elles règlent et ce qu'elles
excluent. Chaque ligne est aussi documentée en contexte dans le code
(commentaires en tête de service) — cette section est le récap.

**Un seul fichier SQLite pour les deux modes** — 2 tables physiques, aucune
donnée partagée entre les modes. Choix explicite plutôt que 2 fichiers
séparés : simplifie le déploiement (une seule chose à checkout/persister en
CI, cf `radar-signaux-data`), pas de complexité gagnée à séparer.

**Migrations additives sans outil dédié** — pas de `typeorm-migrations` ni
`prisma migrate`. Inspecter `PRAGMA table_info` avant chaque `ALTER TABLE
ADD COLUMN` suffit à ce volume, sans dépendance ni fichier de migration à
maintenir. Ré-évaluer si le schéma devient plus dynamique (`DROP COLUMN`,
renommages, foreign keys) — jamais le cas jusqu'à présent.

**Serveur MCP hors DI Nest** — voir plus haut. Un process léger doit
démarrer vite, charger tout le conteneur Nest est disproportionné pour lire
4 requêtes SQLite.

**`run-once.ts` en CI, `@Cron` en local** — voir plus haut. Deux modèles
d'exécution, une seule logique métier. Bug réel corrigé par cette
architecture : `InpiService` et `InpiActesService` s'étaient retrouvés
**sans aucun `@Cron`** (construits, testés, jamais planifiés), silencieux
en process persistant local — trouvé en rejouant la séquence complète en un
seul process avant de coder `run-once.ts` (11/08 soir).

**Pas de refactor "au cas où"** — chaque service est un vrai vertical
(fetch + parse + write), pas de couche "repository" abstraite au-dessus de
`StorageService`. Sylvain a explicitement délégué le radar en ship rapide
avec l'IA (protocole 01/08) ; la passe d'apprentissage active viendra plus
tard (post-Alstom), et se fera *sur le code livré* — refactor "propre"
maintenant volerait cet exercice pédagogique.

**Tests de non-régression ciblés, pas de couverture générique** — 35 tests
sur les vrais bugs rencontrés en direct pendant la construction (regex RCS
Caroll/Salesforce, garde-fou de cohérence, bascule EAA/art.47, formulation
narrative RGAA, extraction actes Galeon, décodage charset, etc.), pas de
tests écrits pour la métrique. Voir le README section « Tests » pour la
liste.

**robots.txt vérifié avant tout fetch mode a11y** — condition explicite de
la fiche CNIL du 19/06/2025 sur le scraping de données publiques. Un
`Disallow` a la même sémantique qu'un blocage anti-bot dans la logique
(statut distinct, jamais confondu avec « rien trouvé »).

**Régime juridique par CA réel, pas par tranche du prospect qualifié** —
les prospects sont filtrés par un *plancher* (>2 M€ CA), pas un plafond.
Une entreprise à CA >250 M€ passe le filtre EAA mais relève d'un autre
régime (art. 47/Arcom, sanctions et texte différents). Sans bascule
automatique dans `argumentaire`, on reproduirait l'erreur exacte du TJ de
Lille (05-06/05/2026, ApiDV/Droit Pluriel c. Auchan E-Commerce, débouté
pour mauvais seuil appliqué).

## Ce qui n'est PAS ici (encore)

Cadré dans la mémoire projet, pas démarré côté code :

- **Dashboard V2** (cadré 24/08/2026) : interface de consultation web par
  dessus le SQLite (remplace le mail volatile), recheck a11y à la demande,
  toggle par mode (BODACC seul, a11y seul, tout).
- **Module « acquisition commerciale »** (cadré 25/08/2026) : enrichissement
  contact (dirigeant/DPO), template email violation-aware, CRM léger (table
  `contacts` à ajouter), séquence de relance J+7/J+21/J+45. À démarrer
  après examen RGAA du 23/10/2026 (priorité) et ouverture auto-entreprise
  (pour facturer).
- **Passe d'apprentissage active** : promise dans le protocole 01/08,
  intégrée au curriculum comme checkpoint dédié (reformulation à froid +
  reconstruction d'un module en page blanche). Jamais faite. Tant qu'elle
  n'est pas faite, le radar ne compte pas comme acquis NestJS/TDD.
