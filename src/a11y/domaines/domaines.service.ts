import { Injectable, Logger } from '@nestjs/common';
import { gunzipSync } from 'zlib';

const CRUX_URL_TEMPLATE =
  'https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/country/fr/{mois}.csv.gz';

/**
 * Source des domaines cibles (mode Freelance a11y) : classement CrUX
 * (Chrome UX Report) France, publie mensuellement en clair sur GitHub
 * (zakird/crux-top-lists), gratuit, sans compte BigQuery. Format CSV :
 * `origin,rank` -- rank = palier de popularite (1000, 5000, 10000, ...).
 *
 * Portee France uniquement pour l'instant (decision du 11/08 : pas
 * d'abstraction multi-pays tant qu'un vrai besoin international n'existe
 * pas -- le mecanisme de detection de declaration change trop d'un regime
 * juridique a l'autre pour se generaliser a l'aveugle).
 */
@Injectable()
export class DomainesService {
  private readonly logger = new Logger(DomainesService.name);

  /** Domaines FR dont le rang CrUX est <= limite (10000 = top 10k). */
  async listerDomaines(limite = 500): Promise<string[]> {
    const { csv, mois } = await this.telechargerDernierDisponible();

    const domaines: string[] = [];
    for (const ligne of csv.split('\n')) {
      if (!ligne || ligne.startsWith('origin,')) continue;
      const [origin, rankStr] = ligne.split(',');
      const rank = Number(rankStr);
      if (!origin || Number.isNaN(rank) || rank > limite) continue;
      try {
        domaines.push(new URL(origin).hostname);
      } catch {
        // origin malformee, ignoree
      }
    }

    this.logger.log(
      `CrUX ${mois} : ${domaines.length} domaine(s) FR avec rang <= ${limite}.`,
    );
    return domaines;
  }

  /**
   * Essaie le mois courant puis remonte mois par mois : le fichier CrUX a
   * generalement ~1 mois de retard de publication, le mois courant n'existe
   * souvent pas encore (constate en direct le 11/08 : dernier dispo = 07/2026).
   */
  private async telechargerDernierDisponible(
    maxReculMois = 3,
  ): Promise<{ csv: string; mois: string }> {
    const d = new Date();
    for (let i = 0; i <= maxReculMois; i++) {
      const essai = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const mois = `${essai.getFullYear()}${String(essai.getMonth() + 1).padStart(2, '0')}`;
      const url = CRUX_URL_TEMPLATE.replace('{mois}', mois);
      const response = await fetch(url);
      if (response.ok) {
        const gz = Buffer.from(await response.arrayBuffer());
        return { csv: gunzipSync(gz).toString('utf-8'), mois };
      }
    }
    throw new Error(
      `Aucun fichier CrUX disponible sur les ${maxReculMois + 1} derniers mois.`,
    );
  }
}
