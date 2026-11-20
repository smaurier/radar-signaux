import { Journal } from '../journal/journal';
import { LectureArticle, Rejet, validerLectures } from './lecture-article';

export interface BilanLecture {
  demandes: number;
  lues: number;
  levees: number;
  rejets: Rejet[];
  /** Aucun fichier de lectures : l'etape de lecture n'a pas tourne ou a echoue. */
  fichierAbsent: boolean;
}

const ETAPE = 'Lecture des articles (Claude)';

/**
 * @param aLire le fichier ecrit par notre code : les articles demandes
 * @param lectures le fichier ecrit par le modele, null s'il n'existe pas
 */
export function preparerImport(
  aLire: string,
  lectures: string | null,
): { valides: LectureArticle[]; bilan: BilanLecture } {
  const demandes = new Set(
    (JSON.parse(aLire) as Array<{ url: string }>).map((a) => a.url),
  );

  if (lectures === null) {
    return {
      valides: [],
      bilan: bilan(demandes.size, [], [], true),
    };
  }

  let brut: unknown;
  try {
    brut = JSON.parse(lectures);
  } catch {
    return {
      valides: [],
      bilan: bilan(
        demandes.size,
        [],
        [{ url: null, raison: 'fichier illisible' }],
        false,
      ),
    };
  }

  const { valides, rejets } = validerLectures(brut, demandes);
  return { valides, bilan: bilan(demandes.size, valides, rejets, false) };
}

function bilan(
  demandes: number,
  valides: LectureArticle[],
  rejets: Rejet[],
  fichierAbsent: boolean,
): BilanLecture {
  return {
    demandes,
    lues: valides.length,
    levees: valides.reduce((total, l) => total + l.levees.length, 0),
    rejets,
    fichierAbsent,
  };
}

export function ajouterAuJournal(
  journal: Journal,
  bilanLecture: BilanLecture,
): Journal {
  const echecs = [...journal.echecs];

  if (bilanLecture.fichierAbsent && bilanLecture.demandes > 0) {
    echecs.push({
      etape: ETAPE,
      message:
        "aucun fichier de lectures alors que des articles étaient à lire : jeton absent ou expiré, quota de l'abonnement atteint, ou lecture en échec",
    });
  }
  if (bilanLecture.rejets.length > 0) {
    const detail = bilanLecture.rejets
      .map((r) => `${r.url ?? 'fichier'} (${r.raison})`)
      .join(', ');
    echecs.push({
      etape: ETAPE,
      message: `${bilanLecture.rejets.length} lecture(s) rejetée(s) : ${detail}`,
    });
  }

  return {
    ...journal,
    echecs,
    lecture: {
      demandes: bilanLecture.demandes,
      lues: bilanLecture.lues,
      levees: bilanLecture.levees,
      rejets: bilanLecture.rejets.length,
    },
  };
}
