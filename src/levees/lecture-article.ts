import { z } from 'zod';

/**
 * Contrat entre le modele qui lit les articles et notre code. Le fichier qu'il
 * rend vient de pages web : il est traite comme une entree non fiable, et tout
 * ce qui sort du contrat est rejete, jamais stocke.
 */

// Au-dela, ce ne serait plus un resume reformule mais un extrait recopie :
// les mentions legales de Maddyness interdisent la reproduction sans accord.
const LONGUEUR_MAX_RESUME = 200;

const LeveeLue = z
  .strictObject({
    nom: z.string().trim().min(1).max(100),
    montant: z.number().positive().nullable(),
    devise: z.enum(['EUR', 'USD']).nullable(),
    recrutement: z.boolean(),
    resumeRecrutement: z.string().trim().max(LONGUEUR_MAX_RESUME).nullable(),
  })
  .refine((l) => (l.montant === null) === (l.devise === null), {
    message: 'montant et devise vont ensemble',
  });

const LectureArticle = z
  .strictObject({
    url: z.string(),
    genre: z.enum(['levee', 'recap', 'sans_levee']),
    levees: z.array(LeveeLue),
  })
  .refine((l) => (l.genre === 'sans_levee') === (l.levees.length === 0), {
    message:
      'un article sans levee ne liste aucune levee, les autres au moins une',
  });

export type LeveeLue = z.infer<typeof LeveeLue>;
export type LectureArticle = z.infer<typeof LectureArticle>;

export interface Rejet {
  url: string | null;
  raison: string;
}

export function validerLectures(
  brut: unknown,
  demandes: ReadonlySet<string>,
): { valides: LectureArticle[]; rejets: Rejet[] } {
  if (!Array.isArray(brut)) {
    return {
      valides: [],
      rejets: [{ url: null, raison: "le fichier n'est pas une liste" }],
    };
  }

  const valides: LectureArticle[] = [];
  const rejets: Rejet[] = [];
  const dejaLues = new Set<string>();

  for (const element of brut) {
    const url = urlDe(element);
    const lecture = LectureArticle.safeParse(element);

    if (!lecture.success) {
      rejets.push({ url, raison: lecture.error.issues[0].message });
    } else if (!demandes.has(lecture.data.url)) {
      rejets.push({ url, raison: 'article non demandé' });
    } else if (dejaLues.has(lecture.data.url)) {
      rejets.push({ url, raison: 'article lu deux fois' });
    } else {
      dejaLues.add(lecture.data.url);
      valides.push(lecture.data);
    }
  }

  return { valides, rejets };
}

function urlDe(element: unknown): string | null {
  if (typeof element === 'object' && element !== null && 'url' in element) {
    return typeof element.url === 'string' ? element.url : null;
  }
  return null;
}
