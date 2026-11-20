# radar-signaux

![CI](https://github.com/smaurier/radar-signaux/actions/workflows/ci.yml/badge.svg)

![NestJS](https://img.shields.io/badge/-NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/-Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white)

Radar de veille sur les entreprises françaises, construit uniquement sur des données
publiques : BODACC, registre national des entreprises (INPI), API Recherche d'entreprises,
presse spécialisée et sites web des entreprises. Chaque jour, il repère des entreprises qui
ont de bonnes chances d'avoir un besoin à court terme, souvent avant qu'elles ne
l'expriment publiquement.

Projet personnel développé en NestJS et TypeScript. Il tourne en production tous les jours.

## Deux cas d'usage

### 1. Les entreprises qui viennent de lever des fonds

Une levée de fonds se traduit presque toujours par des recrutements et des projets à lancer
vite. Tout l'enjeu est de le savoir tôt.

Le radar s'appuie sur le greffe : une augmentation de capital est publiée au BODACC dès que
l'opération est juridiquement bouclée, souvent avant tout communiqué de presse. Il capte
aussi les levées qui ne sont jamais annoncées. Chaque signal est ensuite qualifié : secteur
d'activité, effectif, capital, sens réel de l'opération (augmentation ou réduction), article
de presse quand il en existe un.

**À quoi ça sert** : repérer tôt les entreprises en croissance, susceptibles de renforcer
rapidement leurs équipes techniques.

### 2. Les entreprises soumises à l'obligation d'accessibilité

Depuis le 28 juin 2025, l'European Accessibility Act impose aux sites e-commerce d'être
accessibles aux personnes en situation de handicap, sous le contrôle de la DGCCRF. Beaucoup
d'entreprises concernées n'ont pas de déclaration d'accessibilité, ou en publient une qui
déclare leur propre site non conforme.

Le radar part des sites e-commerce français les plus visités, retrouve l'entreprise derrière
chaque site, vérifie qu'elle dépasse les seuils retenus (plus de 10 salariés et plus de
2 M€ de chiffre d'affaires), cherche sa déclaration d'accessibilité, puis lance un scan
automatique pour relever des défauts concrets. Il produit pour chaque entreprise une fiche
factuelle : texte applicable, autorité compétente, sanctions encourues, constats.

**À quoi ça sert** : repérer les entreprises qui ont une obligation légale à remplir, et donc
un besoin d'audit et de mise en conformité.

## Ce qui tourne aujourd'hui

État au 19/11/2026 :

- **Un passage automatique chaque jour** sur GitHub Actions, sans serveur à maintenir. Chaque
  passage laisse un journal (`journal/AAAA/MM/JJ.json`) : étapes, durées, échecs.
- **12 470 signaux** de modification de capital collectés sur les 3 derniers mois, sur toute
  la France.
- **1 160 sites e-commerce** analysés pour l'accessibilité.
- **Un digest email** par cas d'usage après chaque passage, dès qu'il y a du nouveau.
- **77 tests automatisés** et une intégration continue (lint, build, tests) sur chaque
  modification.

Le dépôt ne contient que le code. Les résultats (listes d'entreprises, constats) sont
stockés dans un dépôt privé séparé : une détection automatique peut se tromper, et un faux
positif ne doit jamais devenir public.

## Prochaine étape : une interface de consultation

Aujourd'hui, les résultats arrivent par email. L'étape suivante est une interface web pour
s'en servir au quotidien :

- la **liste des entreprises repérées**, triée par fraîcheur, avec des filtres : cas
  d'usage, région, secteur, taille ;
- une **fiche par entreprise** pour en savoir plus avant de la contacter : activité,
  effectif, dirigeants, capital, contexte de la levée ou état de l'accessibilité ;
- un **suivi** simple : statut, notes, export.

Toutes ces informations sont disponibles dans les sources que le radar interroge déjà.

## Limites connues

- **Une modification de capital n'est pas forcément une levée de fonds.** Le BODACC ne
  précise ni le sens ni le montant de l'opération. La lecture du procès-verbal de décision
  trouve le sens dans 53 % des cas, et le montant exact rarement (environ 1 %, mesuré sur
  177 signaux réels). Le montant annoncé dans la presse est la piste suivante.
- **Le scan automatique ne couvre qu'une partie de l'accessibilité** (de l'ordre de 30 à
  50 % des défauts réels : la navigation au clavier, l'ordre de lecture ou la pertinence des
  textes alternatifs restent hors de sa portée). Il sert à illustrer, jamais à calculer un
  taux de conformité. La déclaration du site reste la référence.
- **Une part importante des sites bloque les requêtes automatisées** (4 sur 10 dans un
  échantillon testé). Le radar se replie alors sur un vrai navigateur, et un blocage n'est
  jamais confondu avec une absence de déclaration.
- **Chaque fiche est relue par un humain avant tout contact.** Le radar produit des faits,
  pas des messages prêts à envoyer.

## Comment ça marche : levées de fonds

1. **Détection** : appel quotidien à l'API BODACC (gratuite, sans clé, paginée). Le radar
   retient les avis « Modifications diverses » qui mentionnent le capital, sur toute la
   France par défaut (une région peut être ciblée par configuration).
2. **Déduplication** : chaque signal (SIREN et date de parution) n'est traité qu'une fois.
3. **Enrichissement** : l'API Recherche d'entreprises donne le code NAF, la catégorie, la
   tranche d'effectif et la date de création. Un repère « tech probable » (programmation,
   édition de logiciels, R&D, télécoms) aide au tri. C'est une aide à la lecture, pas un
   filtre : rien n'est écarté sur cette base.
4. **Confirmation presse** : les noms d'entreprises (normalisés, formes juridiques
   retirées) sont rapprochés des flux RSS de Maddyness et FrenchWeb.
5. **Capital actuel** : lu au registre national des entreprises (API INPI RNE). Le schéma
   JSON du registre n'étant pas documenté de façon fiable, le champ est retrouvé par
   balayage des clés plutôt que par un chemin deviné.
6. **Sens de l'opération** : le radar télécharge le procès-verbal de décision (PDF texte)
   et en extrait le sens (augmentation ou réduction) et, quand la formulation le permet, le
   montant. Une relance automatique sur les erreurs réseau passagères a fait passer le taux
   de traitement de 77 % à 100 %.
7. **Digest email** : les signaux « tech probable » en détail (capital, sens, montant quand
   il est connu), le reste résumé en un compte.

## Comment ça marche : accessibilité

Le parcours est inversé : le répertoire SIRENE ne contient pas les sites web, donc le radar
part du site pour retrouver l'entreprise.

1. **Sourcing** : classement CrUX (Chrome UX Report) des domaines français, publié chaque
   mois en open data (environ 917 000 domaines). Tant que le fichier du mois n'est pas
   publié, le radar se replie sur le mois précédent.
2. **robots.txt respecté** avant toute requête, à chaque étape. Un `Disallow` est traité
   comme un blocage, jamais comme « rien trouvé ». C'est une condition posée par la fiche
   de la CNIL du 19/06/2025 sur la collecte de données publiques en ligne.
3. **SIREN** : extrait des mentions légales du site (lien trouvé dans la page, puis chemins
   usuels), avec repli sur un navigateur headless (Playwright) quand le site bloque les
   requêtes simples.
4. **Qualification** : chiffre d'affaires et effectif via l'API Recherche d'entreprises. Un
   chiffre d'affaires confidentiel donne un statut distinct (`donnees_indisponibles`), jamais
   « sous le seuil » par défaut. Un garde-fou compare le nom de l'entreprise au domaine : en
   cas d'incohérence (SIREN d'un tiers capté par erreur), l'entreprise passe en `suspect` et
   sort de la liste.
5. **Déclaration d'accessibilité** : recherchée sur la page d'accueil, via un lien
   « accessibilité » trouvé dans la page, sur les chemins usuels, puis par rendu navigateur
   (pied de page injecté en JavaScript). Deux formes sont reconnues : la mention normalisée
   (« Accessibilité : totalement, partiellement ou non conforme ») et les formulations
   rédigées (« le site X est non conforme au RGAA »).
6. **Scan axe-core** : réservé aux entreprises qualifiées sans déclaration conforme. Les
   5 violations les plus graves sont retenues.
7. **Fiche factuelle** : texte applicable, autorité compétente, sanctions et constats. Le
   régime est choisi selon le chiffre d'affaires réel : au-delà de 250 M€, c'est l'article 47
   de la loi du 11 février 2005 qui s'applique (contrôle de l'Arcom), avec d'autres
   sanctions. Confondre les deux régimes a déjà fait échouer une action en justice (TJ de
   Lille, mai 2026).
8. **Digest email** quotidien.

## Stack

NestJS et TypeScript, SQLite (`better-sqlite3`), Playwright et `@axe-core/playwright`,
GitHub Actions pour l'exécution planifiée. Aucune dépendance payante.

Structure du code (modules, schémas SQLite, flux d'exécution, décisions d'architecture) :
[`docs/architecture.md`](docs/architecture.md). Déploiement (dépôt de données séparé,
secrets, point d'entrée dédié) : [`docs/deploiement-github-actions.md`](docs/deploiement-github-actions.md).

## Tests

```bash
npm test
```

77 tests. Le projet a été développé avec une assistance IA, et les tests ne visent pas une
couverture de façade : chaque bug réel rencontré en testant contre les vraies API a été figé
en test de non-régression. Parmi eux : une formulation rédigée de déclaration d'accessibilité
que la première version ratait, une regex RCS trop stricte qui renvoyait le SIREN d'une autre
entreprise (et le garde-fou qui rattrape ce cas), la bascule de régime juridique selon le
chiffre d'affaires, l'extraction du sens d'un acte INPI réel, le décodage des pages qui ne
sont pas servies en UTF-8, et la politique de rétention de la base.

La rétention mérite une ligne : les signaux sont purgés après 3 mois, les sites analysés
après 1 an. La déduplication reposant sur la clé primaire, purger une ligne autorise son
retraitement. Le passage refuse donc de démarrer si la rétention n'est pas au moins quatre
fois plus longue que la fenêtre de collecte : un passage en échec vaut mieux qu'une volée
d'emails en double.

## Démarrage

```bash
npm install
npx playwright install chromium   # navigateur headless (repli anti-bot, accessibilité)
npm run start                     # démarre l'API sur http://localhost:3000
```

En local, `npm run start` démarre l'API et les tâches planifiées (`@nestjs/schedule`). En
production, le passage quotidien passe par un point d'entrée dédié (`src/cron/run-once.ts`)
qui exécute toute la séquence une fois puis s'arrête.

### Déclencher une étape à la main

```bash
# levées de fonds
curl -X POST http://localhost:3000/bodacc/run          # collecte immédiate
curl -X POST http://localhost:3000/entreprises/enrichir # enrichissement (NAF, secteur, effectif)
curl -X POST http://localhost:3000/inpi/qualifier       # capital actuel via l'API INPI
curl -X POST http://localhost:3000/inpi/lire-actes      # procès-verbal (sens et montant)
curl -X POST http://localhost:3000/presse/run           # confirmation par la presse
curl -X POST http://localhost:3000/notifications/run    # digest email (si signaux en attente)
curl http://localhost:3000/bodacc/signaux               # signaux stockés

# accessibilité : étapes isolées
curl "http://localhost:3000/a11y/domaines?limite=1000"              # domaines FR cibles (CrUX)
curl "http://localhost:3000/a11y/siren?domaine=www.exemple.fr"       # SIREN des mentions légales
curl "http://localhost:3000/a11y/qualification?siren=X&domaine=Y"    # CA, effectif, cohérence
curl "http://localhost:3000/a11y/declaration?domaine=www.exemple.fr" # déclaration d'accessibilité
curl "http://localhost:3000/a11y/scan?domaine=www.exemple.fr"        # violations axe-core

# accessibilité : parcours complet (enchaîne, persiste, s'arrête dès qu'un site sort de la course)
curl -X POST "http://localhost:3000/a11y/traiter?domaine=www.exemple.fr"       # un domaine
curl -X POST "http://localhost:3000/a11y/traiter-lot?limiteDomaines=1000&n=10" # un lot CrUX
curl "http://localhost:3000/a11y/prospects"   # entreprises qualifiées, déclaration absente ou non conforme
curl "http://localhost:3000/a11y/recent"      # tout ce qui a été traité, quelle que soit l'issue
curl -X POST "http://localhost:3000/a11y/notifications/run"           # digest email
curl "http://localhost:3000/a11y/argumentaire?domaine=www.exemple.fr" # fiche factuelle
```

⚠️ Le rang CrUX n'est **pas continu** : les seules valeurs possibles sont 1000, 5000, 10000,
50000, 100000, 500000 et 1000000. `limiteDomaines=20` ne retourne donc rien, il faut au
moins `1000`.

### Configuration (variables d'environnement, `.env` local jamais commité)

| Variable | Défaut | Rôle |
|---|---|---|
| `BODACC_REGION_CODE` | *(vide = France entière)* | Restreindre à une région (ex. `84` = AURA) |
| `BODACC_LOOKBACK_DAYS` | `7` | Fenêtre de recherche glissante (jours) |
| `RADAR_DB_PATH` | `./data/radar.sqlite` | Emplacement de la base locale |
| `PORT` | `3000` | Port HTTP |
| `GMAIL_USER` | | Adresse Gmail émettrice des digests |
| `GMAIL_APP_PASSWORD` | | Mot de passe d'application Gmail (pas le mot de passe du compte) |
| `RADAR_NOTIFY_TO` | `GMAIL_USER` | Destinataire des digests |
| `INPI_USERNAME` / `INPI_PASSWORD` | | Identifiants du compte data.inpi.fr (accès API RNE) |

## Serveur MCP (lecture seule)

Le radar s'interroge aussi depuis un client MCP (par exemple Claude Code), sans service
réseau exposé : le client lance le process à la demande, qui lit la base SQLite en lecture
seule. Le radar reste une application autonome, un client MCP n'est qu'un lecteur de plus.

```bash
npm run mcp   # lance le serveur en stdio
```

Configuration côté client (par exemple `.mcp.json`, chemins absolus propres à chaque poste,
jamais commités) :

```json
{
  "mcpServers": {
    "radar-signaux": {
      "command": "npx",
      "args": ["tsx", "/chemin/absolu/vers/radar-signaux/src/mcp/server.ts"],
      "env": { "RADAR_DB_PATH": "/chemin/absolu/vers/radar-signaux/data/radar.sqlite" }
    }
  }
}
```

| Tool | Rôle |
|---|---|
| `get_signals` | Signaux de levées récents, enrichis quand c'est possible |
| `get_leads` | Entreprises qualifiées pour l'accessibilité (plus de 10 salariés, plus de 2 M€ de CA, déclaration absente ou non conforme) |
| `search_company` | Recherche par nom, SIREN ou domaine dans les deux cas d'usage |
| `get_argumentaire` | Fiche factuelle juridique et technique d'une entreprise déjà analysée |
