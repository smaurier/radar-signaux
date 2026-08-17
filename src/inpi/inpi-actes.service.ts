import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PDFParse } from 'pdf-parse';
import { StorageService } from '../storage/storage.service';
import { INPI_BASE_URL, InpiAuthService } from './inpi-auth.service';
import { InpiActe, InpiAttachmentsResponse } from './inpi.types';

interface CapitalParse {
  sens: 'hausse' | 'baisse' | null;
  capitalAvant: number | null;
  capitalApres: number | null;
  erreur: string | null;
}

// types de documents privilegies pour trouver le recit de la decision
// (PV/decision), par ordre de preference -- PJ_02 (statuts) ecarte : ne
// montre que l'etat final, jamais l'ancien montant ni le mot "augmentation"
const TYPES_ACTES_PERTINENTS = ['PJ_54', 'PJ_52'];

/**
 * Lecture d'actes (mode Dev, etape complementaire a InpiService) : va lire
 * le PV de decision (PDF) associe au signal pour determiner le SENS
 * (hausse/baisse) et le MONTANT reel de la modification de capital --
 * l'information que InpiService ne peut pas donner (il ne lit que l'etat
 * actuel, pas l'historique).
 *
 * Approche par extraction de texte + regex sur la formulation juridique
 * standard ("Augmentation de Capital" / "Reduction de Capital", "au
 * capital de X euros" en preambule, "s'eleve desormais a Y euros" dans le
 * corps de l'acte). Validee en direct sur un cas reel (Galeon, 11/08/2026) :
 * PDF texte natif (pas de scan), extraction et calcul du delta coherents
 * avec le capital actuel deja lu par InpiService.
 *
 * **Limite assumee** : formulation juridique non standardisee -- un cabinet
 * different peut rediger autrement. Regex = best effort, pas une garantie.
 * Les cas non reconnus sont marques erreur explicite plutot que devines.
 */
@Injectable()
export class InpiActesService {
  private readonly logger = new Logger(InpiActesService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly auth: InpiAuthService,
  ) {}

  // 7h20, apres la qualification INPI (7h10) -- laisse plus de marge que
  // les autres etapes (telechargement PDF + parsing, plus lent). Meme
  // oubli que InpiService : aucun cron avant le 11/08 (soir), trouve en
  // rejouant la sequence complete manuellement.
  @Cron('20 7 * * *')
  async runDaily(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const candidats = this.storage.listSignauxSansActeLu();
    if (candidats.length === 0) {
      this.logger.log('Lecture actes : rien a traiter.');
      return 0;
    }

    let token: string;
    try {
      token = await this.auth.getToken();
    } catch (err) {
      this.logger.error(
        `Lecture actes : login en echec, annule (${(err as Error).message})`,
      );
      return 0;
    }

    let traites = 0;
    for (const signal of candidats) {
      try {
        const acte = await this.trouverActePertinent(signal.siren, token);
        if (!acte) {
          this.storage.markActeLu(signal.siren, signal.dateParution, {
            sens: null,
            capitalAvant: null,
            capitalApres: null,
            acteId: null,
            erreur: 'aucun acte PJ_54/PJ_52 trouve pour ce SIREN',
          });
          traites++;
          await this.attendre(300);
          continue;
        }

        const texte = await this.telechargerEtExtraire(acte.id, token);
        const parse = this.parserCapital(texte);
        this.storage.markActeLu(signal.siren, signal.dateParution, {
          ...parse,
          acteId: acte.id,
        });
        if (parse.erreur) {
          this.logger.warn(
            `Acte ${acte.id} (SIREN ${signal.siren}) : ${parse.erreur}`,
          );
        }
        traites++;
      } catch (err) {
        this.logger.warn(
          `Lecture acte SIREN ${signal.siren} en echec, ignore (${(err as Error).message})`,
        );
      }
      await this.attendre(300);
    }

    this.logger.log(
      `Lecture actes : ${traites}/${candidats.length} signal(aux) traite(s).`,
    );
    return traites;
  }

  /**
   * Un seul retry apres une courte pause : ~23% des appels echouaient avec
   * "fetch failed" (generique, probablement transitoire) sur un lot de
   * test de 100 signaux -- pas assez de signal pour diagnostiquer plus
   * finement (rate limit ? reset reseau ?), mais un retry simple recupere
   * une bonne part de ces echecs sans complexifier.
   */
  private async fetchAvecRetry(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    try {
      return await fetch(url, options);
    } catch (err) {
      this.logger.debug(
        `Requete en echec, nouvel essai dans 500ms (${(err as Error).message})`,
      );
      await this.attendre(500);
      return fetch(url, options);
    }
  }

  private async trouverActePertinent(
    siren: string,
    token: string,
  ): Promise<InpiActe | null> {
    const response = await this.fetchAvecRetry(
      `${INPI_BASE_URL}/companies/${siren}/attachments`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(
        `Liste des actes en echec (${response.status} ${response.statusText})`,
      );
    }
    const body = (await response.json()) as InpiAttachmentsResponse;
    const actes = (body.actes ?? []).filter(
      (a) => a.typeDocument && TYPES_ACTES_PERTINENTS.includes(a.typeDocument),
    );
    if (actes.length === 0) return null;

    // le plus recent d'abord, priorite PJ_54 (PV d'AG) sur PJ_52 (decision du representant legal)
    actes.sort((a, b) => {
      const dateDiff =
        new Date(b.dateDepot).getTime() - new Date(a.dateDepot).getTime();
      if (dateDiff !== 0) return dateDiff;
      return (
        TYPES_ACTES_PERTINENTS.indexOf(a.typeDocument!) -
        TYPES_ACTES_PERTINENTS.indexOf(b.typeDocument!)
      );
    });
    return actes[0];
  }

  private async telechargerEtExtraire(
    acteId: string,
    token: string,
  ): Promise<string> {
    const response = await this.fetchAvecRetry(
      `${INPI_BASE_URL}/actes/${acteId}/download`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(
        `Telechargement acte en echec (${response.status} ${response.statusText})`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const parser = new PDFParse({ data: buffer });
    const resultat = await parser.getText();
    return resultat.text;
  }

  /**
   * Extraction par regex de la formulation juridique standard. Voir le
   * commentaire de classe pour la validation sur cas reel et la limite
   * assumee (formulation non garantie identique partout).
   */
  private parserCapital(texte: string): CapitalParse {
    const sensMatch = texte.match(/(Augmentation|R[ée]duction) de Capital/i);
    let sens: 'hausse' | 'baisse' | null = sensMatch
      ? /augmentation/i.test(sensMatch[0])
        ? 'hausse'
        : 'baisse'
      : null;

    let capitalAvant: number | null = null;
    let capitalApres: number | null = null;

    // Formulation la plus repandue en pratique dans les PV d'AG : "le
    // capital social ... est porte de X euros a Y euros" (augmentation) /
    // "reduit de X euros a Y euros" (reduction) -- capture les deux
    // montants en un seul motif. Ajoutee le 13/08 : les motifs precedents
    // (preambule "au capital de" + corps "s'eleve desormais a") n'avaient
    // ete calibres que sur le cas Galeon et donnaient ~1% de reussite sur
    // le montant exact (177 signaux reels, cf README). Cette formulation
    // "porte de/a" est le standard le plus courant chez les cabinets, donc
    // essayee en priorite -- mais reste une extension par pattern connu
    // du jargon juridique francais, PAS reverifiee sur un corpus reel
    // comme le cas Galeon (limite honnetement documentee ici).
    const porteMatch = texte.match(
      /port[ée]e?\s+de\s+([\d.,\s]+?)\s*euros?\s+[àa]\s+([\d.,\s]+?)\s*euros?/i,
    );
    const reduiteMatch = texte.match(
      /r[ée]duite?\s+de\s+([\d.,\s]+?)\s*euros?\s+[àa]\s+([\d.,\s]+?)\s*euros?/i,
    );
    if (porteMatch) {
      capitalAvant = this.parseNombreFrancais(porteMatch[1]);
      capitalApres = this.parseNombreFrancais(porteMatch[2]);
      if (!sens) sens = 'hausse';
    } else if (reduiteMatch) {
      capitalAvant = this.parseNombreFrancais(reduiteMatch[1]);
      capitalApres = this.parseNombreFrancais(reduiteMatch[2]);
      if (!sens) sens = 'baisse';
    }

    // Repli : formulations separees deja calibrees (cas Galeon) -- ne
    // complete que ce qui manque encore apres le motif "porte de/a".
    if (capitalAvant === null) {
      const ancienMatch = texte.match(/au capital de\s+([\d.,\s]+?)\s*euros?/i);
      capitalAvant = ancienMatch
        ? this.parseNombreFrancais(ancienMatch[1])
        : null;
    }
    if (capitalApres === null) {
      // "s'eleve desormais a Y euros" (apostrophe typographique possible),
      // sinon "fixe a la somme de Y euros" (autre formulation courante).
      const nouveauMatch =
        texte.match(
          /s['’]?[ée]l[èe]ve d[ée]sormais [àa]\s+([\d.,\s]+?)\s*euros?/i,
        ) ??
        texte.match(/fix[ée]e?\s+[àa]\s+la somme de\s+([\d.,\s]+?)\s*euros?/i);
      capitalApres = nouveauMatch
        ? this.parseNombreFrancais(nouveauMatch[1])
        : null;
    }

    const erreur =
      !sens && capitalAvant === null && capitalApres === null
        ? 'aucun motif capital reconnu dans le texte (formulation non standard ou PDF non texte)'
        : null;

    return { sens, capitalAvant, capitalApres, erreur };
  }

  /** "39.026,31656" (format FR : point = millier, virgule = decimale) -> 39026.31656 */
  private parseNombreFrancais(brut: string): number | null {
    const nombre = parseFloat(
      brut.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'),
    );
    return Number.isNaN(nombre) ? null : nombre;
  }

  private attendre(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
