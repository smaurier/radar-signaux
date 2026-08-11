import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorageService } from '../storage/storage.service';
import { RechercheEntreprisesResponse } from './entreprises.types';

const API_URL = 'https://recherche-entreprises.api.gouv.fr/search';

/**
 * Enrichissement sectoriel (mode Dev, etape intercalaire) : appelle l'API
 * gratuite "Recherche d'entreprises" (recherche-entreprises.api.gouv.fr,
 * sans cle) pour recuperer NAF, section d'activite, categorie d'entreprise,
 * tranche d'effectif et date de creation de chaque SIREN detecte au BODACC.
 *
 * Ne au constat du 11/08 : le pipeline ne filtrait que par region, et un
 * jugement a l'oeil sur les noms d'entreprise a rate une vraie fintech/
 * healthtech (Galeon) prise pour une PME locale. Ce module remplace le
 * jugement a l'oeil par une donnee verifiable -- mais NE FILTRE PAS les
 * signaux : il les tague, la decision reste humaine (cf isSecteurTechProbable).
 */
@Injectable()
export class EntreprisesService {
  private readonly logger = new Logger(EntreprisesService.name);

  // ~5 req/s, sous la limite ~7 req/s de l'API, sans cle donc pas de retry agressif
  private readonly delaiEntreAppelsMs = 200;

  constructor(private readonly storage: StorageService) {}

  // ~5 min apres le cron BODACC (7h), avant la confirmation presse (7h15)
  @Cron('5 7 * * *')
  async runDaily(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const candidats = this.storage.listUnenriched();
    if (candidats.length === 0) {
      this.logger.log('Enrichissement : rien a enrichir.');
      return 0;
    }

    let enrichis = 0;
    for (const candidat of candidats) {
      try {
        const resultat = await this.chercherParSiren(candidat.siren);
        this.storage.markEnriched(candidat.siren, candidat.dateParution, {
          nafCode: resultat?.activite_principale ?? null,
          sectionActivite: resultat?.section_activite_principale ?? null,
          categorieEntreprise: resultat?.categorie_entreprise ?? null,
          trancheEffectif: resultat?.tranche_effectif_salarie ?? null,
          dateCreation: resultat?.date_creation ?? null,
        });
        enrichis++;
      } catch (err) {
        this.logger.warn(
          `Enrichissement SIREN ${candidat.siren} en echec, ignore (${(err as Error).message})`,
        );
      }
      await this.attendre(this.delaiEntreAppelsMs);
    }

    this.logger.log(`Enrichissement : ${enrichis}/${candidats.length} signal(aux) enrichi(s).`);
    return enrichis;
  }

  private async chercherParSiren(siren: string) {
    const params = new URLSearchParams({ q: siren });
    const response = await fetch(`${API_URL}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`API Recherche d'entreprises en echec (${response.status})`);
    }
    const body = (await response.json()) as RechercheEntreprisesResponse;
    return body.results?.find((r) => r.siren === siren) ?? body.results?.[0];
  }

  private attendre(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Heuristique d'affichage seulement (jamais utilisee pour filtrer/supprimer
 * un signal) : section J (info/communication) ou NAF de programmation,
 * edition logicielle, R&D. A verifier manuellement -- ce n'est qu'un
 * indice, pas une classification fiable (cf le faux "PME locale" du 11/08).
 */
export function isSecteurTechProbable(
  nafCode: string | null | undefined,
  sectionActivite: string | null | undefined,
): boolean {
  if (sectionActivite === 'J') return true;
  if (!nafCode) return false;
  const prefixesTech = ['62', '63', '58.2', '26', '72'];
  return prefixesTech.some((prefixe) => nafCode.startsWith(prefixe));
}
