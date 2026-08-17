import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DomainesService } from '../domaines/domaines.service';
import { MentionsLegalesService } from '../entreprises/mentions-legales.service';
import { QualificationService } from '../entreprises/qualification.service';
import { DeclarationService } from '../declaration/declaration.service';
import { ScanService } from '../scan/scan.service';
import {
  A11yStorageService,
  ProspectA11y,
} from '../storage/a11y-storage.service';

/**
 * Orchestrateur du pipeline a11y : enchaine les 4 etapes (SIREN,
 * qualification, declaration, scan) pour UN domaine, avec arret anticipe
 * des que le domaine sort de la course -- le scan axe-core notamment est
 * couteux (5-15s) et n'a aucun interet sur un mauvais candidat.
 *
 * Regles d'arret (l'etape atteinte est toujours persistee, meme en cas
 * d'arret precoce -- utile pour ne pas re-traiter un domaine deja
 * disqualifie a un run suivant) :
 * - Pas de SIREN trouve -> arret apres 'siren'.
 * - Qualification 'sous_seuil' ou 'suspect' -> arret apres 'qualification'
 *   (suspect = incoherence nom/domaine, cf le cas Caroll/Salesforce -- ne
 *   jamais avancer sur un match dont on doute).
 *   'donnees_indisponibles' n'arrete PAS le pipeline : le CA confidentiel
 *   ne veut pas dire "hors cible", juste "on ne sait pas" -- la
 *   declaration reste un signal utile independamment.
 * - Declaration 'conforme' -> arret (pas un prospect, ils sont en regle).
 * - Declaration 'bloque' ou 'indetermine' -> arret (rien de solide a
 *   montrer, le scan ne changerait rien a l'incertitude).
 * - Sinon ('absente', 'non_conforme', 'partiel') -> scan axe-core.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly domaines: DomainesService,
    private readonly mentionsLegales: MentionsLegalesService,
    private readonly qualification: QualificationService,
    private readonly declaration: DeclarationService,
    private readonly scan: ScanService,
    private readonly storage: A11yStorageService,
  ) {}

  async traiterDomaine(domaine: string): Promise<ProspectA11y> {
    const prospect: ProspectA11y = { domaine, etapeAtteinte: 'siren' };

    const resSiren = await this.mentionsLegales.extraireSiren(domaine);
    prospect.siren = resSiren.siren;
    prospect.statutSiren = resSiren.statut;
    prospect.sourceUrlSiren = resSiren.sourceUrl;
    if (resSiren.statut !== 'trouve' || !resSiren.siren) {
      this.storage.enregistrer(prospect);
      return prospect;
    }

    prospect.etapeAtteinte = 'qualification';
    const resQualif = await this.qualification.qualifier(
      resSiren.siren,
      domaine,
    );
    prospect.nomComplet = resQualif.nomComplet;
    prospect.nafCode = resQualif.nafCode;
    prospect.categorieEntreprise = resQualif.categorieEntreprise;
    prospect.trancheEffectif = resQualif.trancheEffectif;
    prospect.ca = resQualif.ca;
    prospect.anneeCa = resQualif.anneeCa;
    prospect.coherentAvecDomaine = resQualif.coherentAvecDomaine;
    prospect.statutQualification = resQualif.statut;
    if (resQualif.statut === 'sous_seuil' || resQualif.statut === 'suspect') {
      this.storage.enregistrer(prospect);
      return prospect;
    }

    prospect.etapeAtteinte = 'declaration';
    const resDecl = await this.declaration.detecter(domaine);
    prospect.statutDeclaration = resDecl.statut;
    prospect.sourceUrlDeclaration = resDecl.sourceUrl;
    if (
      resDecl.statut === 'conforme' ||
      resDecl.statut === 'bloque' ||
      resDecl.statut === 'indetermine'
    ) {
      this.storage.enregistrer(prospect);
      return prospect;
    }

    prospect.etapeAtteinte = 'scan';
    const resScan = await this.scan.scanner(domaine);
    prospect.scanTotalViolations = resScan.totalViolations;
    prospect.scanTopViolations = JSON.stringify(resScan.topViolations);

    this.storage.enregistrer(prospect);
    return prospect;
  }

  /**
   * Traite les N domaines suivants du classement CrUX pas encore vus.
   * Sequentiel avec pause entre chaque -- le pipeline complet par domaine
   * peut deja enchainer plusieurs appels reseau + navigateur, pas la peine
   * d'ajouter de la pression supplementaire avec du parallélisme.
   */
  // 7h45, avant le digest a11y (8h) -- laisse une marge apres le mode Dev
  // (7h-7h30) pour ne pas saturer le navigateur headless partage.
  @Cron('45 7 * * *')
  async runDaily(): Promise<void> {
    await this.traiterLot();
  }

  /**
   * Defaut 10000 : le plus petit palier CrUX reellement peuple est 1000
   * (pas de valeur continue en dessous, cf domaines.service.ts) -- un
   * defaut plus bas ne retournerait silencieusement rien. 15/jour : le
   * pipeline complet par domaine peut enchainer plusieurs appels reseau +
   * navigateur (jusqu'a un scan axe-core), pas la peine de viser un trop
   * gros volume par run quotidien.
   */
  async traiterLot(
    limiteDomaines = 10000,
    nombreATraiter = 15,
  ): Promise<ProspectA11y[]> {
    const domaines = await this.domaines.listerDomaines(limiteDomaines);
    const aTraiter = domaines
      .filter((d) => !this.storage.dejaTraite(d))
      .slice(0, nombreATraiter);

    const resultats: ProspectA11y[] = [];
    for (const domaine of aTraiter) {
      try {
        const prospect = await this.traiterDomaine(domaine);
        resultats.push(prospect);
      } catch (err) {
        this.logger.warn(
          `Pipeline ${domaine} en echec, ignore (${(err as Error).message})`,
        );
      }
      await this.attendre(500);
    }

    this.logger.log(
      `Pipeline a11y : ${resultats.length}/${aTraiter.length} domaine(s) traite(s) (sur ${domaines.length} candidats CrUX).`,
    );
    return resultats;
  }

  private attendre(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
