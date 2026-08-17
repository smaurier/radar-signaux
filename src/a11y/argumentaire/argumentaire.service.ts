import { Injectable } from '@nestjs/common';

// seuil de bascule vers le regime art.47/Arcom (loi 2005-102) : au-dela,
// ce n'est PLUS le regime EAA code conso qui s'applique en priorite.
// Piege juridique reel constate dans l'etude de faisabilite du 01/08 :
// le TJ de Lille (05-06/05/2026, affaire ApiDV/Droit Pluriel c. Auchan
// E-Commerce) a debate en appliquant a tort le seuil art.47 (250M€) a
// une entite relevant du regime EAA -- ne jamais reproduire cette
// confusion, dans un sens ou dans l'autre.
const SEUIL_ART47_CA = 250_000_000;

export type RegimeApplicable = 'eaa_code_conso' | 'art47_arcom' | 'indetermine';

interface ViolationResume {
  id: string;
  impact: string | null;
  aide: string;
  nombreOccurrences: number;
}

export interface ProspectPourArgumentaire {
  domaine: string;
  nomComplet: string | null;
  siren: string | null;
  nafCode: string | null;
  ca: number | null;
  statutDeclaration: string | null;
  sourceUrlDeclaration: string | null;
  scanTotalViolations: number | null;
  scanTopViolations: string | null; // JSON stringifie (ViolationResume[])
}

export interface Argumentaire {
  regime: RegimeApplicable;
  texte: string;
}

/**
 * Genere un argumentaire factuel par prospect (mode Freelance a11y) --
 * PAS un pitch commercial redige, un ensemble de faits verifiables
 * organises pour servir de base a un contact humain. Objectif explicite
 * de l'etude de faisabilite du 01/08 : "argumentaire EAA juridiquement
 * precis obligatoire" -- la DGCCRF enquete aussi sur la loyaute des
 * cabinets d'audit d'accessibilite, un pitch alarmiste ou juridiquement
 * faux est un risque en soi, pas juste une maladresse commerciale.
 *
 * **Ne jamais citer un montant du mauvais regime.** Les "50 000€"/
 * "25 000€" repris partout sur le web concernent le regime art.47/Arcom
 * (secteur public + entreprises >250M€ CA) -- inapplicable a la quasi
 * totalite de nos prospects (>10 salaries, >2M€ CA = plancher, pas
 * plafond). D'ou la distinction de regime selon le CA reel avant tout
 * generation de texte.
 */
@Injectable()
export class ArgumentaireService {
  genererArgumentaire(prospect: ProspectPourArgumentaire): Argumentaire {
    const regime = this.determinerRegime(prospect.ca);
    const texte = [
      this.paragrapheRegime(regime, prospect),
      this.paragrapheConstat(prospect),
      this.paragrapheTechnique(prospect),
      this.paragrapheAvertissement(regime),
    ]
      .filter(Boolean)
      .join('\n\n');

    return { regime, texte };
  }

  private determinerRegime(ca: number | null): RegimeApplicable {
    if (ca === null) return 'indetermine';
    return ca >= SEUIL_ART47_CA ? 'art47_arcom' : 'eaa_code_conso';
  }

  private paragrapheRegime(
    regime: RegimeApplicable,
    prospect: ProspectPourArgumentaire,
  ): string {
    if (regime === 'art47_arcom') {
      return (
        `⚠️ CA (${this.formaterCa(prospect.ca)}) au-dessus de ${this.formaterCa(SEUIL_ART47_CA)} : ` +
        `${prospect.nomComplet ?? prospect.domaine} releve probablement du regime de l'article 47 de la loi ` +
        `2005-102 (secteur public + grandes entreprises), pas du regime EAA code conso. Autorite de controle : ` +
        `Arcom, pas DGCCRF. Sanctions : jusqu'a 25 000€ (defaut de publication de la declaration) ou 50 000€ ` +
        `(defaut d'accessibilite, historiquement secteur public). A VERIFIER avant tout contact : ce texte n'a ` +
        `pas ete adapte a ce regime, le reste de l'argumentaire ci-dessous suppose a tort le regime EAA.`
      );
    }

    if (regime === 'indetermine') {
      return (
        `⚠️ CA inconnu (donnee confidentielle ou non trouvee) : impossible de determiner avec certitude si ` +
        `${prospect.nomComplet ?? prospect.domaine} releve du regime EAA code conso (>10 salaries, >2M€ CA) ` +
        `ou du regime art.47/Arcom (>250M€ CA). Le texte ci-dessous suppose le regime EAA par defaut -- a ` +
        `verifier avant tout contact.`
      );
    }

    return (
      `Regime applicable : Etablissement d'Accessibilite Aux services (EAA), transpose au code de la ` +
      `consommation (ordonnance n°2023-859 du 15/09/2023, art. L.412-13 et D.412-49 a D.412-62, annexe ` +
      `D.412-57, arrete du 09/10/2023). En vigueur depuis le 28/06/2025. Autorite de controle : DGCCRF. ` +
      `Obligation : decrire dans les CGV (ou un document equivalent) la maniere dont les exigences ` +
      `d'accessibilite sont remplies, en format accessible. Sanction : contravention de 5e classe -- ` +
      `1 500€ (personne physique) / 7 500€ (personne morale, 15 000€ en recidive) + injonctions DGCCRF ` +
      `avec astreinte pouvant aller jusqu'a 3 000€/jour.`
    );
  }

  private paragrapheConstat(prospect: ProspectPourArgumentaire): string {
    const entreprise = `${prospect.nomComplet ?? prospect.domaine} (SIREN ${prospect.siren ?? 'inconnu'}, NAF ${prospect.nafCode ?? 'inconnu'}, CA ${this.formaterCa(prospect.ca)})`;

    if (prospect.statutDeclaration === 'absente') {
      return (
        `Constat : aucune declaration d'accessibilite trouvee sur ${entreprise} (home, chemins usuels, ` +
        `rendu navigateur inclus). C'est le grief le plus frequent dans les mises en demeure deja engagees ` +
        `sur ce regime (ex. cas Picard : absence totale de declaration, cite dans l'etude de faisabilite).`
      );
    }
    if (
      prospect.statutDeclaration === 'non_conforme' ||
      prospect.statutDeclaration === 'partiel'
    ) {
      const source = prospect.sourceUrlDeclaration
        ? ` (source : ${prospect.sourceUrlDeclaration})`
        : '';
      return (
        `Constat : ${entreprise} publie une declaration d'accessibilite indiquant un statut ` +
        `"${prospect.statutDeclaration}"${source} -- la demarche existe, l'ecart de conformite est deja ` +
        `assume publiquement par l'entreprise elle-meme.`
      );
    }
    return `Constat : statut de declaration non concluant pour ${entreprise} (a verifier manuellement).`;
  }

  private paragrapheTechnique(
    prospect: ProspectPourArgumentaire,
  ): string | null {
    if (!prospect.scanTopViolations || !prospect.scanTotalViolations)
      return null;
    let violations: ViolationResume[];
    try {
      violations = JSON.parse(prospect.scanTopViolations) as ViolationResume[];
    } catch {
      return null;
    }
    if (violations.length === 0) return null;

    const liste = violations
      .map(
        (v) =>
          `- ${v.aide} (${v.impact}, ${v.nombreOccurrences} occurrence(s))`,
      )
      .join('\n');
    return (
      `Elements techniques (scan automatise, page d'accueil, ${prospect.scanTotalViolations} anomalie(s) ` +
      `au total -- couverture partielle, ~30-50% des violations reelles selon la doc axe-core, ne remplace ` +
      `jamais un audit RGAA complet) :\n${liste}`
    );
  }

  private paragrapheAvertissement(regime: RegimeApplicable): string {
    return (
      `Rappel avant tout envoi : la DGCCRF enquete aussi sur la loyaute des prestataires d'audit ` +
      `d'accessibilite (3 enquetes lancees janvier 2026 dont une specifiquement sur ce point) -- un ` +
      `argumentaire alarmiste ou juridiquement approximatif est un risque en soi, pas seulement une ` +
      `maladresse commerciale. ${regime === 'eaa_code_conso' ? 'Ne jamais citer les montants 25 000€/50 000€ (regime art.47/Arcom, non applicable ici).' : ''} ` +
      `Ce texte est une base factuelle, pas un email pret a envoyer -- relecture humaine obligatoire.`
    ).trim();
  }

  private formaterCa(ca: number | null): string {
    if (ca === null) return 'inconnu';
    return `${ca.toLocaleString('fr-FR')} €`;
  }
}
