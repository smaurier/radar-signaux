import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorageService } from '../storage/storage.service';
import { InpiCompanyResponse } from './inpi.types';
import { INPI_BASE_URL, InpiAuthService } from './inpi-auth.service';

interface CapitalCandidate {
  path: string;
  value: number;
}

/**
 * Qualification INPI (mode Dev, etape finale du pipeline) : lit le capital
 * social actuel d'une entreprise via l'API RNE, pour distinguer un vrai
 * candidat (capital significatif) d'un signal BODACC bruyant.
 *
 * Limite assumee (a documenter, pas a cacher) : cet endpoint donne le
 * capital ACTUEL, pas l'historique. Savoir si la modification detectee au
 * BODACC etait une hausse ou une baisse demanderait de lire l'acte
 * (PV d'AG/statuts, PDF) associe a cette formalite precise -- hors scope
 * de ce module, qui se contente d'exposer le montant courant comme
 * contexte utile (filtrer les capitaux symboliques, prioriser les gros).
 *
 * Le schema JSON exact du RNE n'etant pas documente de facon fiable, le
 * capital est recherche par balayage recursif des cles contenant "capital"
 * plutot que par un chemin fige devine a l'aveugle (cf extractCapital).
 */
@Injectable()
export class InpiService {
  private readonly logger = new Logger(InpiService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly auth: InpiAuthService,
  ) {}

  private async getCompany(siren: string, token: string): Promise<InpiCompanyResponse | null> {
    const response = await fetch(`${INPI_BASE_URL}/companies/${siren}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Lecture INPI ${siren} en echec (${response.status} ${response.statusText})`);
    }
    return (await response.json()) as InpiCompanyResponse;
  }

  /**
   * Balayage recursif : toute cle contenant "capital" (insensible a la
   * casse) associee a une valeur numerique ou numerique-en-chaine est un
   * candidat. Retourne tous les candidats pour calibration/log, le
   * meilleur (priorite aux cles "montantCapital"/"capitalSocial") en tete.
   */
  private findCapitalCandidates(value: unknown, path = ''): CapitalCandidate[] {
    const candidats: CapitalCandidate[] = [];
    if (value === null || typeof value !== 'object') return candidats;

    for (const [cle, val] of Object.entries(value as Record<string, unknown>)) {
      const cheminActuel = path ? `${path}.${cle}` : cle;
      if (/capital/i.test(cle)) {
        // exclut explicitement les booleens : Number(false) = 0 serait sinon
        // capte a tort comme "capital = 0" (cas reel : "capitalVariable": false)
        const estNumerique = typeof val === 'number' || (typeof val === 'string' && val.trim() !== '');
        const num = typeof val === 'number' ? val : Number(val);
        if (typeof val !== 'boolean' && estNumerique && !Number.isNaN(num)) {
          candidats.push({ path: cheminActuel, value: num });
        }
      }
      if (val && typeof val === 'object') {
        candidats.push(...this.findCapitalCandidates(val, cheminActuel));
      }
    }
    return candidats;
  }

  private meilleurCandidat(candidats: CapitalCandidate[]): CapitalCandidate | null {
    if (candidats.length === 0) return null;
    const prioritaire = candidats.find((c) => /montantCapital|capitalSocial/i.test(c.path));
    return prioritaire ?? candidats[0];
  }

  // 7h10, apres l'enrichissement (7h05) -- OUBLIE lors de la construction
  // initiale (11/08) : InpiService et InpiActesService n'avaient AUCUN
  // cron, ce module ne tournait donc jamais automatiquement malgre son
  // integration dans le README/pipeline documente. Trouve en rejouant la
  // sequence complete du cron manuellement.
  @Cron('10 7 * * *')
  async runDaily(): Promise<void> {
    await this.run();
  }

  /** Qualifie un lot de signaux non encore verifies. Retourne le nombre traite. */
  async run(): Promise<number> {
    const candidats = this.storage.listUnqualifiedByInpi();
    if (candidats.length === 0) {
      this.logger.log('INPI : rien a qualifier.');
      return 0;
    }

    let token: string;
    try {
      token = await this.auth.getToken();
    } catch (err) {
      this.logger.error(`INPI : login en echec, qualification annulee (${(err as Error).message})`);
      return 0;
    }

    let traites = 0;
    for (const signal of candidats) {
      try {
        const company = await this.getCompany(signal.siren, token);
        if (!company) {
          this.storage.markQualifiedByInpi(signal.siren, signal.dateParution, {
            capital: null,
            erreur: 'SIREN introuvable via API INPI',
          });
          traites++;
          continue;
        }
        const tousCandidats = this.findCapitalCandidates(company);
        const meilleur = this.meilleurCandidat(tousCandidats);
        if (!meilleur) {
          this.logger.warn(
            `INPI ${signal.siren} : aucune cle "capital" trouvee dans la reponse (cles racine : ${Object.keys(company).join(', ')}).`,
          );
        } else if (tousCandidats.length > 1) {
          this.logger.debug(
            `INPI ${signal.siren} : ${tousCandidats.length} candidats capital trouves, retenu "${meilleur.path}"=${meilleur.value}.`,
          );
        }
        this.storage.markQualifiedByInpi(signal.siren, signal.dateParution, {
          capital: meilleur ? meilleur.value : null,
          erreur: meilleur ? null : 'chemin capital introuvable dans la reponse',
        });
        traites++;
      } catch (err) {
        this.logger.warn(`INPI ${signal.siren} en echec, ignore (${(err as Error).message})`);
      }
      await this.attendre(150);
    }

    this.logger.log(`INPI : ${traites}/${candidats.length} signal(aux) qualifie(s).`);
    return traites;
  }

  private attendre(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
