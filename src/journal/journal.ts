/**
 * Journal de run et politique de retention.
 *
 * Deux besoins qui se servent du meme artefact, decides le 04/11/2026 :
 *
 * 1. **Trace durable de ce que le radar sort.** Aujourd'hui le seul temoin d'un
 *    run est le log GitHub Actions, que GitHub finit par effacer. Un resume par
 *    run, commite dans ce depot, survit.
 * 2. **Battement de coeur.** GitHub desactive un workflow planifie apres 60
 *    jours d'inactivite du depot, et un run planifie ne compte pas comme une
 *    activite. C'est arrive : derniere activite visible le 16/08/2026, cron
 *    coupe le 16/10, 61 jours, personne ne l'a vu pendant 18 jours. Le cron
 *    poussait dans `radar-signaux-data`, jamais ici. Un commit de journal par
 *    jour dans CE depot remet le compteur a zero tous les jours.
 *
 * Le journal est un RESUME, jamais un second registre : les lignes vivent dans
 * SQLite, qui porte deja la dedup (cle primaire) et l'avancement par etape
 * (`enrichi`, `inpi_qualifie`, `acte_lu`, `presse_confirmee`, `notifie_email`).
 * Dupliquer les lignes ici creerait une seconde source de verite qui derive.
 */

export interface ReglePurge {
  readonly table: string;
  /** Colonne horodatee qui porte l'age de la ligne. */
  readonly colonne: string;
  readonly jours: number;
}

/**
 * Retention demandee par Sylvain : 3 mois pour les signaux de recrutement
 * (mode Dev, issus de BODACC), 1 an pour le reste.
 *
 * ⚠️ Cote a11y, purger un domaine le REOUVRE au retraitement, puisque le lot
 * CrUX le contient toujours. C'est voulu : un an sans re-scan, un site a pu
 * changer. Ce n'est pas un effet de bord, c'est un cycle de re-scan annuel.
 */
export const POLITIQUE_RETENTION: readonly ReglePurge[] = [
  { table: 'bodacc_signaux', colonne: 'first_seen_at', jours: 90 },
  { table: 'a11y_prospects', colonne: 'traite_le', jours: 365 },
];

/** Journaux gardes un an, comme "le reste" de la politique. */
export const RETENTION_JOURNAL_JOURS = 365;

/**
 * Marge exigee entre la retention et la fenetre de collecte. Un facteur, pas
 * un ecart en jours : il garde son sens quelle que soit l'echelle.
 */
const FACTEUR_SECURITE = 4;

/**
 * ⛔ L'invariant a ne jamais casser : **retention >> fenetre de collecte**.
 *
 * La dedup des signaux BODACC ne repose pas sur une marque "deja vu" mais sur
 * la cle primaire `(siren, date_parution)` et un `INSERT OR IGNORE`. Purger une
 * ligne REAUTORISE donc son retraitement, exactement l'inverse de l'intuition.
 * Ce qui rend la purge sans danger est que BODACC n'est interroge que sur
 * `BODACC_LOOKBACK_DAYS` jours (7 par defaut) : une parution plus vieille que
 * la fenetre ne peut plus revenir de l'API.
 *
 * Si quelqu'un monte la fenetre de collecte sans toucher la retention, on se
 * remet a renotifier du vieux. D'ou cette verification, appelee au demarrage du
 * run pour echouer tot et bruyamment plutot que d'envoyer des mails en double.
 */
export function verifierInvariantRetention(
  fenetreCollecteJours: number,
  politique: readonly ReglePurge[] = POLITIQUE_RETENTION,
): void {
  const plusCourte = politique.reduce((a, b) => (a.jours <= b.jours ? a : b));
  const minimumRequis = fenetreCollecteJours * FACTEUR_SECURITE;

  if (plusCourte.jours < minimumRequis) {
    throw new Error(
      `Invariant casse : la retention de ${plusCourte.table} (${plusCourte.jours} j) ` +
        `doit rester tres superieure a la fenetre de collecte (${fenetreCollecteJours} j), ` +
        `au moins ${FACTEUR_SECURITE} fois, soit ${minimumRequis} j. ` +
        `Purger une ligne reautorise son retraitement : la dedup est la cle primaire ` +
        `plus INSERT OR IGNORE, pas une marque "deja vu".`,
    );
  }
}

function deuxChiffres(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Chemin du journal d'un run, en UTC : le runner GitHub est en UTC, et un run
 * de 23h30 doit rester le jour de son declenchement, pas glisser au lendemain
 * selon le fuseau de celui qui relit.
 */
export function cheminJournal(maintenant: Date): string {
  const annee = maintenant.getUTCFullYear();
  const mois = deuxChiffres(maintenant.getUTCMonth() + 1);
  const jour = deuxChiffres(maintenant.getUTCDate());
  return `journal/${annee}/${mois}/${jour}.json`;
}

export interface EtapeExecutee {
  readonly nom: string;
  readonly dureeMs: number;
  /** Message d'erreur si l'etape a echoue. Une etape en echec n'arrete pas le run. */
  readonly echec?: string;
}

export interface Journal {
  readonly run: string;
  readonly declencheur: string;
  readonly etapes: ReadonlyArray<{ nom: string; dureeS: number }>;
  readonly echecs: ReadonlyArray<{ etape: string; message: string }>;
  readonly purge: Readonly<Record<string, number>>;
  readonly tailles: Readonly<Record<string, number>>;
  readonly octetsBase: number;
}

export function construireJournal(entree: {
  maintenant: Date;
  declencheur: string;
  etapes: readonly EtapeExecutee[];
  purge: Readonly<Record<string, number>>;
  tailles: Readonly<Record<string, number>>;
  octetsBase: number;
}): Journal {
  return {
    run: entree.maintenant.toISOString(),
    declencheur: entree.declencheur,
    // Une etape en echec reste listee ici : le journal doit dire qu'elle a
    // tourne et combien de temps, pas seulement qu'elle a rate.
    etapes: entree.etapes.map((e) => ({
      nom: e.nom,
      dureeS: Math.round(e.dureeMs / 1000),
    })),
    echecs: entree.etapes
      .filter((e) => e.echec !== undefined)
      .map((e) => ({ etape: e.nom, message: e.echec as string })),
    purge: entree.purge,
    tailles: entree.tailles,
    octetsBase: entree.octetsBase,
  };
}

const MOTIF_CHEMIN_JOURNAL = /journal\/(\d{4})\/(\d{2})\/(\d{2})\.json$/;

/**
 * Journaux a supprimer. La comparaison se fait au jour, pas a l'instant : le
 * journal du jour pile de la limite est garde, sinon la purge dependrait de
 * l'heure a laquelle le run tombe.
 *
 * Un fichier dont le nom ne porte pas une date lisible est ignore, jamais
 * supprime : cette fonction ne touche que ce qu'elle sait dater.
 */
export function journauxAPurger(
  fichiers: readonly string[],
  maintenant: Date,
  jours: number = RETENTION_JOURNAL_JOURS,
): string[] {
  const limite = Date.UTC(
    maintenant.getUTCFullYear(),
    maintenant.getUTCMonth(),
    maintenant.getUTCDate() - jours,
  );

  return fichiers.filter((fichier) => {
    const trouve = MOTIF_CHEMIN_JOURNAL.exec(fichier.replace(/\\/g, '/'));
    if (trouve === null) {
      return false;
    }
    const [, annee, mois, jour] = trouve;
    const jourDuFichier = Date.UTC(
      Number(annee),
      Number(mois) - 1,
      Number(jour),
    );
    return jourDuFichier < limite;
  });
}
