# radar-signaux

![NestJS](https://img.shields.io/badge/-NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/-Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white)

Moteur de veille économique automatisée sur données ouvertes françaises (BODACC, INPI,
presse spécialisée). Détecte des signaux faibles — ici, les levées de fonds potentielles —
avant ou au moment de leur publication officielle.

## Objectif

Un seul moteur cron, conçu pour porter plusieurs collecteurs indépendants :

- **Mode Dev (implémenté)** — repère les entreprises qui viennent de lever des fonds ou
  sont en train de le faire, en croisant les avis de modification de capital publiés au
  BODACC avec les données INPI (montant) et la presse spécialisée (contexte). Utile pour
  une veille emploi ciblée sur les entreprises en croissance.
- **Mode Freelance a11y (implémenté)** — détecte les sites e-commerce FR sans déclaration
  d'accessibilité RGAA/EAA, pour de la prospection qualifiée. Portée France uniquement
  pour l'instant (pas d'abstraction multi-pays : le mécanisme de détection change trop
  d'un régime juridique à l'autre pour se généraliser sans un vrai besoin concret).

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

## Tests

```bash
npm test
```

Tout le projet a été construit en délégation (pas de TDD), mais chaque bug réel découvert
en testant en direct a été figé en test de non-régression plutôt qu'oublié une fois corrigé
— la logique pure (regex d'extraction, décisions de statut/régime), pas les appels réseau
externes. 35 tests couvrent notamment : la formulation narrative de déclaration RGAA qui
avait fait rater Caroll, la regex RCS trop stricte qui avait renvoyé le SIREN de Salesforce
à la place de celui de Caroll, le garde-fou de cohérence nom/domaine qui l'attrape quand
même, la bascule de régime juridique EAA/art.47 selon le CA réel, et l'extraction sens/
montant d'un acte INPI réel (Galeon).

## Démarrage

```bash
npm install
npx playwright install chromium   # navigateur headless (repli anti-bot, mode a11y)
npm run start                     # démarre l'API sur http://localhost:3000
```

Les crons quotidiens se déclenchent automatiquement une fois l'app démarrée
(`ScheduleModule`) : mode Dev 7h00 détection → 7h05 enrichissement NAF → 7h10 qualification
INPI (capital) → 7h15 confirmation presse → 7h20 lecture d'actes (sens/montant) → 7h30
digest email. Mode a11y : 7h45 pipeline (15 nouveaux domaines CrUX) → 8h00 digest.

⚠️ **Bug réel trouvé le 11/08 (soir) en rejouant la séquence manuellement** : la
qualification INPI et la lecture d'actes avaient été construites, testées et documentées
comme étapes du pipeline, mais **n'avaient aucun `@Cron`** — elles ne tournaient donc
jamais automatiquement, seulement via leurs endpoints POST manuels. Corrigé (7h10/7h20
ci-dessus). Sans avoir rejoué la séquence complète en une fois, ce trou serait resté
invisible indéfiniment : chaque étape testée isolément avait l'air de fonctionner.

✅ **Hébergement : GitHub Actions, planifié tous les jours à 7h Paris**, sans VPS
(`.github/workflows/cron.yml`). Les crons `@nestjs/schedule` décrits ci-dessus décrivent
la logique métier mais ne pilotent plus l'exécution planifiée réelle — celle-ci passe
par un point d'entrée dédié (`src/cron/run-once.ts`) qui exécute toute la séquence une
fois puis quitte, sans process persistant. Détail de l'architecture (repo de données
séparé, secrets requis, piège `tsx`/injection de dépendances rencontré et corrigé) :
[`docs/deploiement-github-actions.md`](docs/deploiement-github-actions.md).

Pour tester sans attendre le cron :

```bash
curl -X POST http://localhost:3000/bodacc/run          # déclenche une collecte immédiate
curl -X POST http://localhost:3000/entreprises/enrichir # enrichit les signaux (NAF, secteur, effectif)
curl -X POST http://localhost:3000/inpi/qualifier       # lit le capital social actuel via l'API INPI
curl -X POST http://localhost:3000/inpi/lire-actes      # lit le PV de decision (sens + montant reels)
curl -X POST http://localhost:3000/presse/run           # tente de confirmer les signaux via la presse
curl -X POST http://localhost:3000/notifications/run    # envoie le digest email (si signaux en attente)
curl http://localhost:3000/bodacc/signaux               # liste les signaux stockés (statut complet)

# mode Freelance a11y — étapes isolées (dev/debug)
curl "http://localhost:3000/a11y/domaines?limite=1000"          # domaines FR cibles (CrUX top N)
curl "http://localhost:3000/a11y/siren?domaine=www.exemple.fr"   # extrait le SIREN des mentions légales
curl "http://localhost:3000/a11y/qualification?siren=X&domaine=Y" # CA/effectif + cohérence
curl "http://localhost:3000/a11y/declaration?domaine=www.exemple.fr" # déclaration RGAA
curl "http://localhost:3000/a11y/scan?domaine=www.exemple.fr"    # violations axe-core

# mode Freelance a11y — pipeline unifié (enchaîne tout, persiste, arrêt anticipé)
curl -X POST "http://localhost:3000/a11y/traiter?domaine=www.exemple.fr"     # un domaine
curl -X POST "http://localhost:3000/a11y/traiter-lot?limiteDomaines=1000&n=10" # lot depuis CrUX
curl "http://localhost:3000/a11y/prospects"  # prospects qualifiés + déclaration non conforme/absente
curl "http://localhost:3000/a11y/recent"     # tout ce qui a été traité, quelle que soit l'issue

curl -X POST "http://localhost:3000/a11y/notifications/run"  # envoie le digest a11y (si prospects en attente)
curl "http://localhost:3000/a11y/argumentaire?domaine=www.exemple.fr" # base factuelle pour un prospect deja traite
```

⚠️ Le rang CrUX n'est **pas continu** : les seules valeurs possibles sont 1000, 5000,
10000, 50000, 100000, 500000, 1000000 (paliers du classement). `limiteDomaines=20` ne
retourne donc rien — utiliser au moins `1000`.

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
   ne dit donc pas, à lui seul, si LA modification détectée au BODACC était une hausse
   ou une baisse ni son montant. Le capital affiché est un indice de taille, pas une
   preuve de levée.
6. **Lecture d'actes** — va plus loin : télécharge le PV de décision (PDF, via l'API RNE
   actes/statuts) et en extrait le texte pour trouver le **sens réel** (« Augmentation »
   vs « Réduction de Capital ») et si possible le **montant exact** de la modification.
   PDF texte natif (pas de scan), donc extractible. **Résultats mesurés en direct sur
   177 signaux réels** : sens détecté dans **53 %** des cas (vrai gain vs le BODACC seul
   qui ne donne jamais ni sens ni montant) ; montant exact (avant **et** après) détecté
   dans seulement **~1 %** des cas — la formulation juridique varie trop d'un cabinet à
   l'autre pour qu'une regex généralise au-delà du cas calibré. Un retry simple sur les
   appels réseau (`fetch failed` transitoires, probablement des connexions HTTP
   recyclées côté serveur) a fait passer le taux de traitement de 77 % à 100 % sans
   rien de plus complexe. **Conclusion honnête** : le sens seul justifie la fonctionnalité,
   le montant exact ne vaut quasiment rien en l'état — à revisiter seulement si le besoin
   de montant précis redevient prioritaire (élargir la bibliothèque de formulations, ou
   accepter une vérification manuelle sur les cas prioritaires plutôt que d'automatiser).
7. **Digest email quotidien** — envoyé via Gmail SMTP (mot de passe d'application, pas
   Telegram : pas installé). Détaille les signaux tagués « tech probable » avec leur
   capital actuel et, quand disponible, le sens/montant réel de la modification. Résume
   le reste en un compte (évite un mail de 250+ lignes).

## Comment ça marche (mode Freelance a11y — en cours)

Pipeline **inversé** par rapport au mode Dev : SIRENE n'a pas les sites web des
entreprises, donc on part du domaine pour retrouver le SIREN, pas l'inverse (cf étude
de faisabilité du 01/08).

1. **Sourcing des domaines** — classement CrUX (Chrome UX Report) France, publié
   mensuellement en clair sur GitHub (`zakird/crux-top-lists`), gratuit, sans compte
   BigQuery. ~917k domaines FR au total (jusqu'au palier top-1M) ; testé en direct sur
   le fichier réel de juillet 2026. Le fichier du mois en cours n'existe pas encore au
   moment de la collecte (retard de publication d'~1 mois) : repli automatique sur les
   mois précédents.
2. **robots.txt respecté** — vérifié avant tout fetch (direct et navigateur headless), sur
   toutes les étapes (SIREN, déclaration, scan). Un `Disallow` est traité avec la même
   sémantique qu'un blocage anti-bot (jamais confondu avec « rien trouvé »). Absence ou
   inaccessibilité du fichier = autorisé par défaut (convention standard, RFC 9309).
   Validé en direct sur un vrai fichier avec règles (`lemonde.fr` : chemin interdit
   correctement bloqué, `Allow` explicite correctement prioritaire sur un `Disallow`
   englobant, 403 sur le fichier lui-même correctement traité comme "autorisé par
   défaut"). Condition explicitement citée par la fiche CNIL du 19/06/2025 sur le
   scraping de données publiques.
3. **Extraction du SIREN** — cherche un lien « mentions légales » dans le HTML de la
   home (priorité au mot dans l'URL elle-même, plus robuste qu'au texte visible du
   lien, qui peut être mal encodé ou enveloppé dans des balises imbriquées), sinon
   essaie des chemins usuels. Motif SIREN/SIRET/RCS cherché sur la page trouvée.
   **Piège d'encodage réel rencontré** : certains sites ne sont pas servis en UTF-8
   propre, un accent (« légales ») devient un caractère de remplacement — les regex
   utilisent un joker plutôt que de deviner l'encodage exact.
4. **Anti-bot, constaté en direct** — sur un échantillon test de 10 domaines réels,
   ~40 % ont bloqué le `fetch()` simple (HTTP 403). Diagnostic confirmé : ce n'est pas
   le User-Agent (curl avec le même UA passait), c'est le **fingerprinting TLS/HTTP**
   du client Node (Datadome et équivalents, très répandus sur l'e-commerce FR). Un
   statut `bloque` distinct est toujours renvoyé (jamais confondu avec « pas de
   déclaration » — un faux négatif de ce genre serait dangereux en prospection). Repli
   automatique via navigateur headless (Playwright/Chromium) sur blocage uniquement
   (pas sur simple timeout, pour ne pas payer le coût du navigateur inutilement) —
   validé en direct : 2 sites précédemment bloqués débloqués avec le bon SIREN retrouvé.
5. **Qualification CA/effectif** — via l'API Recherche d'entreprises (déjà utilisée en
   mode Dev), contre les seuils du régime EAA code conso (**> 10 salariés ET > 2 M€
   CA** — jamais le seuil art. 47/Arcom à 250 M€, piège relevé dans l'étude de
   faisabilité). Statut `donnees_indisponibles` distinct quand le CA est confidentiel
   (fréquent pour les PME/ETI, cf étude) plutôt que de conclure à tort « sous le seuil ».
   **Garde-fou de cohérence critique, né d'un vrai faux positif le 11/08** : le SIREN
   extrait à l'étape précédente peut appartenir à une tout autre entreprise (page
   bloquée par un WAF, contenu tiers capté par erreur au lieu du vrai contenu — constaté
   en direct sur caroll.com, où une regex RCS trop stricte a fait rater le vrai SIREN de
   Caroll et un fallback a récupéré celui de... Salesforce France). Le nom d'entreprise
   trouvé est comparé au domaine (normalisé, présence en sous-chaîne) ; en cas
   d'incohérence, statut forcé à `suspect` quels que soient CA/effectif — des chiffres
   attachés à la mauvaise entreprise ne valent rien et ne doivent jamais atterrir dans
   une liste de prospection sans review.
6. **Détection de la déclaration d'accessibilité** — cherche le texte de conformité RGAA
   sur la home, suit un lien « accessibilité » découvert dans la page (même mécanisme
   que pour les mentions légales — nécessaire : chaque site nomme sa page différemment,
   `/fr_fr/accessibilite-numerique` chez Caroll par exemple, absent de toute liste de
   chemins usuels), essaie des chemins usuels, puis force un rendu navigateur en dernier
   recours (footer de SPA injecté en JS, jamais vu par un simple `fetch()`).
   **Deux formulations réelles constatées, une seule ne suffisait pas** : le texte
   normalisé attendu (« Accessibilité : totalement/partiellement/non conforme ») ET une
   formulation narrative réelle rencontrée sur caroll.com (groupe Beaumanoir) — *« le
   site de Caroll est non conforme au Référentiel Général d'Amélioration de
   l'Accessibilité (RGAA) »* — que la première regex, trop rigide, ratait complètement.
   **Validé en direct sur 5 sites réels** : Caroll → non conforme (30 % des critères
   RGAA respectés, audit Urbilog daté), Chaussea → non conforme, Castorama/Courrier
   International/booknode.com → absente (Courrier International vérifié manuellement :
   zéro mention « accessib* » nulle part sur le site, vrai négatif).
7. **Scan axe-core** — sur les prospects déjà qualifiés (coûteux, réservé à ceux qui ont
   passé les étapes précédentes). `@axe-core/playwright` sur la home, top 5 violations
   triées par gravité (critical > serious > moderate > minor). **Ne remplace jamais la
   déclaration RGAA du site comme preuve** — axe-core ne couvre qu'~30-50 % des
   violations réelles (zéro faux positif, mais couverture partielle : clavier, ordre de
   lecture, pertinence des alternatives restent hors de portée d'un scan automatisé).
   Sert uniquement d'accroche technique concrète en prospection. **Validé en direct sur
   caroll.com** (cohérent avec leur non-conformité déjà connue) : 9 violations, dont 43
   liens sans texte discernable, 6 images sans alternative textuelle, 1 problème de
   contraste — matière concrète pour une accroche, pas un chiffre abstrait.
8. **Argumentaire juridique** — une base factuelle par prospect (pas un email rédigé) :
   texte exact, sanctions réelles, autorité compétente, faits constatés, top violations.
   **Distinction de régime automatique selon le CA réel**, pas seulement celui du
   prospect qualifié minimum : nos prospects sont filtrés par un *plancher* (> 2 M€ CA),
   pas un plafond — une entreprise à CA > 250 M€ relève de l'article 47/Arcom (DGCCRF →
   Arcom, sanctions et texte totalement différents), pas du régime EAA code conso.
   **Reproduit l'erreur exacte du TJ de Lille** (05-06/05/2026, ApiDV/Droit Pluriel c.
   Auchan E-Commerce, débouté pour avoir appliqué le mauvais seuil) si on ne fait pas
   cette distinction — validé en direct : un CA fictif de 300 M€ bascule bien vers
   l'avertissement art. 47/Arcom au lieu de générer un texte EAA erroné. Rappel
   systématique dans le texte généré : ne jamais citer du 25 000 €/50 000 € (mauvais
   régime) à un prospect EAA, la DGCCRF enquête aussi sur la loyauté des prestataires
   d'audit — relecture humaine obligatoire avant tout envoi.

## Roadmap

- [x] Confirmation presse (RSS Maddyness / FrenchWeb, matching par nom d'entreprise)
- [x] Enrichissement sectoriel (NAF/effectif/catégorie, tag tech probable à affiner)
- [x] Notifications par email (Gmail SMTP)
- [x] Passage à la France entière (pagination BODACC)
- [x] Qualification INPI (capital social actuel, validé en direct sur 285 signaux réels,
      0 erreur)
- [x] Lecture d'actes (sens détecté 53 % des cas, montant exact ~1 % — voir limite
      ci-dessus, pas prioritaire à affiner pour l'instant)
- [ ] Affiner l'heuristique « tech probable » avec l'usage (elle peut rater de vraies
      entreprises tech hors classification NAF standard)
- [x] Serveur MCP en lecture seule (`get_signals`, `search_company`) pour interroger le
      radar depuis un autre outil
- [x] Déploiement planifié sans VPS (GitHub Actions, cf
      [`docs/deploiement-github-actions.md`](docs/deploiement-github-actions.md))

### Mode Freelance a11y — **priorité actuelle**, c'est le mode qui intéresse le plus Sylvain

- [x] Sourcing des domaines (CrUX top lists FR)
- [x] Extraction du SIREN depuis les mentions légales, avec repli navigateur headless
      sur blocage anti-bot (validé en direct, ~40 % de blocage sur fetch() simple)
- [x] Qualification CA/effectif/NAF (API Recherche d'entreprises, filtre régime EAA :
      >10 salariés et >2M€ CA) + garde-fou de cohérence nom/domaine (cf faux positif
      Caroll/Salesforce du 11/08)
- [x] Détection de la déclaration d'accessibilité (suivi de lien découvert + chemins
      usuels + rendu navigateur forcé, 2 formulations de conformité reconnues, validé
      en direct sur 5 sites réels — Caroll et Chaussea non conformes, 3 sans déclaration)
- [x] Scan axe-core sur les prospects qualifiés (top 5 violations triées par gravité,
      validé en direct sur caroll.com : 9 violations dont 43 liens sans texte, 6 images
      sans alt — jamais vendu comme un taux de conformité, cf limite dans le code)
- [x] Pipeline unifié (`/a11y/traiter` par domaine, `/a11y/traiter-lot` depuis le
      classement CrUX, persistance SQLite dédiée avec dédup, arrêt anticipé dès qu'un
      domaine sort de la course — pas de scan axe-core gaspillé sur un mauvais candidat)
- [x] Cron automatique (`@Cron('45 7 * * *')` sur le pipeline, 15 domaines/jour) +
      digest email quotidien (8h, réutilise Gmail SMTP déjà configuré pour le mode Dev)
- [x] Argumentaire juridique standardisé (bascule automatique de régime selon le CA réel
      — EAA code conso en dessous de 250 M€, avertissement art. 47/Arcom au-dessus,
      jamais un texte au mauvais régime — validé en direct sur un cas fictif >250M€)
- [x] Serveur MCP en lecture seule (`get_signals`, `get_leads`, `search_company`,
      `get_argumentaire`) — transport stdio, pas d'auth (process local), validé en direct
      (handshake + 4 tools testés avec de vraies données)

## Serveur MCP (lecture seule)

Expose le radar à un client MCP (ex. Claude Code) sans exposer de service réseau : le
process est lancé à la demande par le client, lit directement le SQLite local en lecture
seule. Le radar reste une app autonome (tourne même sans MCP) ; Synapse (ou tout autre
client) n'est qu'un lecteur de plus.

```bash
npm run mcp   # lance le serveur en stdio (attend un client MCP sur stdin/stdout)
```

Configuration côté client (ex. `.mcp.json`, chemins absolus — jamais commité, spécifique
à chaque poste) :

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

4 tools, tous en lecture seule :

| Tool | Rôle |
|---|---|
| `get_signals` | Signaux BODACC récents (mode Dev), avec enrichissement quand disponible |
| `get_leads` | Prospects a11y qualifiés (>10 salariés, >2M€ CA, déclaration non conforme/absente) |
| `search_company` | Recherche par nom/SIREN/domaine dans les deux modes |
| `get_argumentaire` | Base factuelle juridique+technique pour un prospect a11y déjà traité |

**Choix de transport (stdio, pas HTTP+token)** : le process est lancé localement par le
client à la demande, pas de serveur permanent à sécuriser. À reconsidérer seulement si un
client doit un jour appeler le radar depuis autre chose qu'une session locale (ex.
routine cloud) — pas le cas aujourd'hui.

## Étude de faisabilité

Le détail des sources testées (BODACC, INPI, Pappers, flux RSS) et l'analyse juridique du
mode Freelance a11y sont documentés dans un repo privé séparé (non inclus ici, car il
contient des éléments de stratégie personnelle).
