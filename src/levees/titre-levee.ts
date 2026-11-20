export type Devise = 'EUR' | 'USD';

export interface Montant {
  valeur: number;
  devise: Devise;
}

export interface LectureTitre {
  genre: 'levee' | 'recap';
  /** null quand le titre ne nomme pas l'entreprise : il faudra lire l'article. */
  nom: string | null;
  /** null quand le titre ne chiffre pas la levee. */
  montant: Montant | null;
}

const MOIS =
  'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';

// Les frontieres de mot de JS (\b) ignorent les lettres accentuees : "élève"
// contiendrait "lève". D'ou ces bornes explicites sur les lettres Unicode.
const DEBUT = '(?<!\\p{L})';
const FIN = '(?!\\p{L})';

const PERIODE = new RegExp(
  `${DEBUT}(?:cette semaine|en une semaine|en (?:${MOIS}))${FIN}`,
  'iu',
);
const ARGENT_LEVE = new RegExp(
  `${DEBUT}(?:lève|ont levé|levés|levées)${FIN}`,
  'iu',
);
const VERBE_LEVEE = new RegExp(
  `${DEBUT}(?:lèvent|lève|boucl(?:e|ent) (?:un tour de table|une série|une levée|un financement))${FIN}`,
  'iu',
);
const LEVEE_EN_COMPLEMENT = new RegExp(
  `${DEBUT}une levée de fonds${FIN}`,
  'iu',
);
const FONDS_D_INVESTISSEMENT = new RegExp(
  `${DEBUT}(?:son|un|leur|nouveau|premier|second|deuxième|troisième) fonds${FIN}`,
  'iu',
);
const SUJET_QUI_N_EST_PAS_UN_NOM = new RegExp(
  `^(?:l['’]|(?:le|la|les|un|une|des|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|plusieurs|cette|ce|cet|ces|son|sa|ses|leur|leurs|notre|nos)${FIN})`,
  'iu',
);
// Convention FrenchWeb : les noms d'entreprises sont en capitales.
const BENEFICIAIRE_EN_CAPITALES = new RegExp(
  `${DEBUT}pour (\\p{Lu}[\\p{Lu}\\d&.'’-]+(?: \\p{Lu}[\\p{Lu}\\d&.'’-]+)*)${FIN}`,
  'u',
);

const MOTS_MAX_D_UN_NOM = 5;

export function lireTitre(titreBrut: string): LectureTitre | null {
  const titre = titreBrut.replace(/\s+/g, ' ').trim();

  if (PERIODE.test(titre) && ARGENT_LEVE.test(titre)) {
    return { genre: 'recap', nom: null, montant: null };
  }
  if (FONDS_D_INVESTISSEMENT.test(titre)) {
    return null;
  }

  const verbe = VERBE_LEVEE.exec(titre);
  if (!verbe && !LEVEE_EN_COMPLEMENT.test(titre)) {
    return null;
  }

  return {
    genre: 'levee',
    nom: verbe ? lireNom(titre, verbe.index) : null,
    montant: lireMontant(titre),
  };
}

function lireNom(titre: string, positionDuVerbe: number): string | null {
  const sujet = sansIncise(sansTheme(titre.slice(0, positionDuVerbe).trim()));
  const estUnNom =
    sujet.length > 0 &&
    !SUJET_QUI_N_EST_PAS_UN_NOM.test(sujet) &&
    sujet.split(' ').length <= MOTS_MAX_D_UN_NOM;
  if (estUnNom) {
    return sujet;
  }
  return (
    BENEFICIAIRE_EN_CAPITALES.exec(titre.slice(positionDuVerbe))?.[1] ?? null
  );
}

/** "Fintech : Bolide" -> "Bolide" */
function sansTheme(sujet: string): string {
  const separateur = sujet.lastIndexOf(' : ');
  return separateur === -1 ? sujet : sujet.slice(separateur + 3).trim();
}

/** "Après un nouveau cap de revenus récurrents, Brindille" -> "Brindille" */
function sansIncise(sujet: string): string {
  const virgule = sujet.lastIndexOf(', ');
  return virgule === -1 ? sujet : sujet.slice(virgule + 2).trim();
}

const EN_TOUTES_LETTRES =
  /(\d+(?:,\d+)?|un demi)[\s-]*(milliards?|millions?)\s+(d['’]euros|de dollars)/iu;
const EN_SIGLE = /(\d+(?:,\d+)?)\s*M\s?(€|\$)/u;
const EN_CHIFFRES = /(\d{1,3}(?: \d{3})+|\d+)\s*(euros|€|dollars|\$)/iu;

function lireMontant(titre: string): Montant | null {
  const lettres = EN_TOUTES_LETTRES.exec(titre);
  if (lettres) {
    const multiplicateur = lettres[2].toLowerCase().startsWith('milliard')
      ? 1_000_000_000
      : 1_000_000;
    return montant(nombre(lettres[1]) * multiplicateur, lettres[3]);
  }
  const sigle = EN_SIGLE.exec(titre);
  if (sigle) {
    return montant(nombre(sigle[1]) * 1_000_000, sigle[2]);
  }
  const chiffres = EN_CHIFFRES.exec(titre);
  if (chiffres) {
    return montant(nombre(chiffres[1].replace(/ /g, '')), chiffres[2]);
  }
  return null;
}

function nombre(texte: string): number {
  return texte.toLowerCase() === 'un demi'
    ? 0.5
    : Number(texte.replace(',', '.'));
}

function montant(valeur: number, unite: string): Montant {
  // arrondi : 7,1 x 1 000 000 ne tombe pas juste en virgule flottante
  return {
    valeur: Math.round(valeur),
    devise: /dollar|\$/i.test(unite) ? 'USD' : 'EUR',
  };
}
