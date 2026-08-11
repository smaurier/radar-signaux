import { Injectable, Logger } from '@nestjs/common';
import { RechercheEntreprisesResponseA11y, RechercheEntreprisesResultA11y } from './qualification.types';

const API_URL = 'https://recherche-entreprises.api.gouv.fr/search';

// seuils du regime EAA / code de la consommation (PAS le regime art. 47 /
// Arcom a 250M€ -- ne jamais confondre, cf etude de faisabilite et le
// piege releve dedans : les "50 000€" repris partout concernent l'autre
// regime, inapplicable a une PME)
const SEUIL_CA = 2_000_000;
// tranches INSEE dans l'ordre croissant ; "11" (10-19 salaries) = seuil
// ">10 salaries" du regime EAA, approxime par inclusion (10 pile n'est pas
// legalement ">10", mais la tranche ne distingue pas plus finement)
const TRANCHES_ORDRE = [
  '00', '01', '02', '03', '11', '12', '21', '22', '31', '32', '41', '42', '51', '52', '53',
];
const SEUIL_TRANCHE = '11';

export type StatutQualification = 'qualifie' | 'sous_seuil' | 'donnees_indisponibles' | 'suspect';

export interface ResultatQualification {
  statut: StatutQualification;
  nomComplet: string | null;
  nafCode: string | null;
  categorieEntreprise: string | null;
  trancheEffectif: string | null;
  ca: number | null;
  anneeCa: string | null;
  /** null si domaine non fourni a qualifier() ; sinon resultat du garde-fou de coherence. */
  coherentAvecDomaine: boolean | null;
}

/**
 * Qualification CA/effectif (mode Freelance a11y) : reutilise l'API
 * gratuite Recherche d'entreprises deja validee en mode Dev, mais pour
 * verifier le seuil du regime EAA (>10 salaries ET >2M€ CA), pas pour du
 * tagging NAF tech.
 *
 * **Limite connue** (deja signalee dans l'etude de faisabilite du 01/08,
 * a confirmer en direct) : le CA n'est disponible que pour les comptes
 * non confidentiels deposes a l'INPI -- beaucoup de PME/ETI le gardent
 * confidentiel. Un statut 'donnees_indisponibles' distinct evite de
 * classer a tort "sous le seuil" une entreprise dont on ignore juste le CA.
 *
 * **Garde-fou de coherence** (ajoute suite a un cas reel le 11/08) : le
 * SIREN extrait des mentions legales d'un site peut etre celui d'une
 * TOUT AUTRE entreprise (page bloquee par un WAF, contenu tiers capte par
 * erreur -- constate sur caroll.com, SIREN de Salesforce France retourne
 * a la place de celui de Caroll). Si un domaine est fourni, le nom
 * d'entreprise trouve est compare au domaine ; en cas d'incoherence,
 * statut force a 'suspect' quels que soient CA/effectif -- des chiffres
 * attaches a la mauvaise entreprise ne valent rien.
 */
@Injectable()
export class QualificationService {
  private readonly logger = new Logger(QualificationService.name);

  async qualifier(siren: string, domaine?: string): Promise<ResultatQualification> {
    const resultat = await this.chercherParSiren(siren);
    if (!resultat) {
      return {
        statut: 'donnees_indisponibles',
        nomComplet: null,
        nafCode: null,
        categorieEntreprise: null,
        trancheEffectif: null,
        ca: null,
        anneeCa: null,
        coherentAvecDomaine: null,
      };
    }

    const nomComplet = resultat.nom_complet ?? null;
    const coherentAvecDomaine =
      domaine && nomComplet ? this.coherentAvecDomaine(nomComplet, domaine) : null;

    const trancheEffectif = resultat.tranche_effectif_salarie ?? null;
    const { ca, annee } = this.dernierCaConnu(resultat.finances);

    const effectifOk = this.trancheDepasseSeuil(trancheEffectif);
    const caOk = ca !== null ? ca > SEUIL_CA : null;

    let statut: StatutQualification;
    if (coherentAvecDomaine === false) {
      statut = 'suspect';
    } else if (effectifOk === true && caOk === true) {
      statut = 'qualifie';
    } else if (effectifOk === false || caOk === false) {
      statut = 'sous_seuil';
    } else {
      statut = 'donnees_indisponibles';
    }

    return {
      statut,
      nomComplet,
      nafCode: resultat.activite_principale ?? null,
      categorieEntreprise: resultat.categorie_entreprise ?? null,
      trancheEffectif,
      ca,
      anneeCa: annee,
      coherentAvecDomaine,
    };
  }

  /**
   * Verification faible et volontairement permissive (substring apres
   * normalisation) : le coeur du domaine doit apparaitre dans le nom
   * d'entreprise ou l'inverse. Assez pour attraper une entreprise
   * completement sans rapport (Salesforce vs Caroll), pas concu pour
   * detecter des cas plus subtils (filiale, nom commercial different du
   * nom legal).
   */
  private coherentAvecDomaine(nomComplet: string, domaine: string): boolean {
    const coeurDomaine = domaine
      .replace(/^www\./i, '')
      .split('.')[0]
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (coeurDomaine.length < 3) return true; // trop court pour juger sans faux positifs

    const nomNormalise = nomComplet.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return nomNormalise.includes(coeurDomaine) || coeurDomaine.includes(nomNormalise);
  }

  private async chercherParSiren(siren: string): Promise<RechercheEntreprisesResultA11y | null> {
    const params = new URLSearchParams({ q: siren });
    const response = await fetch(`${API_URL}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`API Recherche d'entreprises en echec (${response.status})`);
    }
    const body = (await response.json()) as RechercheEntreprisesResponseA11y;
    return body.results?.find((r) => r.siren === siren) ?? body.results?.[0] ?? null;
  }

  private trancheDepasseSeuil(tranche: string | null): boolean | null {
    if (!tranche) return null;
    const idx = TRANCHES_ORDRE.indexOf(tranche);
    if (idx === -1) return null; // code inconnu/non standard
    return idx >= TRANCHES_ORDRE.indexOf(SEUIL_TRANCHE);
  }

  private dernierCaConnu(
    finances: RechercheEntreprisesResultA11y['finances'],
  ): { ca: number | null; annee: string | null } {
    if (!finances) return { ca: null, annee: null };
    const annees = Object.keys(finances).sort().reverse();
    for (const annee of annees) {
      const ca = finances[annee]?.ca;
      if (typeof ca === 'number' && ca > 0) return { ca, annee };
    }
    return { ca: null, annee: null };
  }
}
