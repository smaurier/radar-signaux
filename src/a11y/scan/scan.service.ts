import { Injectable, Logger } from '@nestjs/common';
import AxeBuilder from '@axe-core/playwright';
import { NavigateurService } from '../navigateur.service';
import { RobotsService } from '../robots.service';

// ordre de priorite pour trier les violations : critique d'abord
const POIDS_IMPACT: Record<string, number> = { critical: 4, serious: 3, moderate: 2, minor: 1 };

export interface ViolationAxe {
  id: string;
  impact: string | null;
  description: string;
  aide: string;
  urlAide: string;
  nombreOccurrences: number;
}

export interface ResultatScan {
  url: string;
  totalViolations: number;
  topViolations: ViolationAxe[];
  erreur: string | null;
}

/**
 * Scan axe-core (mode Freelance a11y, accroche technique pour la
 * prospection) : reserve aux prospects deja qualifies (statut 'qualifie'
 * + declaration absente/non conforme) -- couteux (5-15s/page) et surtout
 * non pertinent sur un site deja conforme ou sur un mauvais candidat.
 *
 * **axe-core detecte ~30-50% des violations reelles (couverture partielle,
 * quasi zero faux positif)** -- cf etude de faisabilite du 01/08.
 * **NE JAMAIS vendre le score axe comme un taux de conformite RGAA** : ce
 * n'est qu'un sous-ensemble automatisable, le controle humain reste
 * necessaire pour le clavier, l'ordre de lecture, la pertinence des
 * alternatives. Sert uniquement d'accroche technique concrete
 * ("3 images sans alternative textuelle sur votre page d'accueil"), pas
 * de preuve de non-conformite en soi (la vraie preuve = la propre
 * declaration RGAA du site, deja lue par DeclarationService).
 */
@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    private readonly navigateur: NavigateurService,
    private readonly robots: RobotsService,
  ) {}

  async scanner(domaine: string): Promise<ResultatScan> {
    const url = `https://${domaine}`;

    if (!(await this.robots.estAutorise(url))) {
      return { url, totalViolations: 0, topViolations: [], erreur: 'robots.txt interdit ce scan' };
    }

    const resultat = await this.navigateur.avecPage(url, async (page) => {
      const analyse = await new AxeBuilder({ page }).analyze();
      const violations = [...analyse.violations]
        .sort((a, b) => (POIDS_IMPACT[b.impact ?? ''] ?? 0) - (POIDS_IMPACT[a.impact ?? ''] ?? 0))
        .slice(0, 5)
        .map((v) => ({
          id: v.id,
          impact: v.impact ?? null,
          description: v.description,
          aide: v.help,
          urlAide: v.helpUrl,
          nombreOccurrences: v.nodes.length,
        }));
      return { totalViolations: analyse.violations.length, topViolations: violations };
    });

    if (!resultat) {
      return { url, totalViolations: 0, topViolations: [], erreur: 'scan impossible (page inaccessible)' };
    }

    this.logger.log(`Scan axe ${domaine} : ${resultat.totalViolations} violation(s) detectee(s).`);
    return { url, ...resultat, erreur: null };
  }
}
