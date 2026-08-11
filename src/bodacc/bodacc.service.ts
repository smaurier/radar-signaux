import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StorageService, BodaccSignal } from '../storage/storage.service';
import { BodaccApiResponse } from './bodacc.types';

const BODACC_API_URL =
  'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';

const PAGE_SIZE = 100; // max par page sur l'API Opendatasoft Explore v2.1
const PAGES_MAX = 50; // garde-fou : 5000 annonces/run maximum

/**
 * Collecteur BODACC (mode Dev) : detecte les modifications de capital
 * publiees au BODACC, sur toute la France par defaut (region filtrable via
 * BODACC_REGION_CODE). Signal "dur" (greffe -> RNE -> BODACC), gratuit,
 * sans cle, quota anonyme largement suffisant pour un cron quotidien. Cf
 * etude private/research/radar-signaux-faisabilite-2026-08.md.
 *
 * Passage a la France entiere decide le 11/08 (Sylvain accepterait du
 * remote, pas de raison de se limiter a une region) : x13 en volume par
 * rapport a AURA seule (~1700 vs ~130 signaux/semaine, verifie en direct),
 * d'ou la pagination ci-dessous (l'API plafonne a 100 resultats/appel).
 *
 * Le BODACC ne donne plus le sens (hausse/baisse) ni le montant depuis le
 * guichet unique (2023) : ce collecteur produit des CANDIDATS a qualifier
 * (etape INPI, hors MVP V1), pas des levees confirmees.
 */
@Injectable()
export class BodaccService {
  private readonly logger = new Logger(BodaccService.name);
  // vide/non defini = France entiere (defaut depuis le 11/08) ; ex. "84" pour se restreindre a AURA
  private readonly regionCode = process.env.BODACC_REGION_CODE ?? '';
  private readonly lookbackDays = Number(process.env.BODACC_LOOKBACK_DAYS ?? 7);

  constructor(private readonly storage: StorageService) {}

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async runDaily(): Promise<void> {
    await this.run();
  }

  /** Interroge le BODACC et stocke les nouveaux signaux. Retourne les nouveaux. */
  async run(): Promise<BodaccSignal[]> {
    const records = await this.fetchAllRecords();
    const signals = records.map((r) => this.toSignal(r));
    const nouveaux = this.storage.upsertNewSignals(signals);
    const zone = this.regionCode ? `region ${this.regionCode}` : 'France entiere';
    this.logger.log(
      `BODACC : ${records.length} annonce(s) recue(s), ${nouveaux.length} nouvelle(s) (${zone}, ${this.lookbackDays}j).`,
    );
    return nouveaux;
  }

  private async fetchAllRecords() {
    const since = this.isoDateDaysAgo(this.lookbackDays);
    const filtreRegion = this.regionCode ? ` AND region_code="${this.regionCode}"` : '';
    const where = `modificationsgenerales like "capital"${filtreRegion} AND dateparution>="${since}"`;

    const all: BodaccApiResponse['results'] = [];
    let totalCount = Infinity;

    for (let page = 0; page < PAGES_MAX && all.length < totalCount; page++) {
      const params = new URLSearchParams({
        where,
        select:
          'dateparution,commercant,registre,region_code,tribunal,modificationsgenerales',
        order_by: 'dateparution desc',
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });

      const url = `${BODACC_API_URL}?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Appel BODACC en echec (${response.status} ${response.statusText})`,
        );
      }
      const body = (await response.json()) as BodaccApiResponse;
      totalCount = body.total_count ?? body.results?.length ?? 0;
      all.push(...(body.results ?? []));
      if (!body.results || body.results.length < PAGE_SIZE) break; // derniere page
    }

    if (all.length < totalCount) {
      this.logger.warn(
        `BODACC : ${totalCount} annonces au total, seulement ${all.length} recuperees (garde-fou ${PAGES_MAX} pages atteint).`,
      );
    }
    return all;
  }

  private toSignal(record: BodaccApiResponse['results'][number]): BodaccSignal {
    const registreRaw = record.registre;
    const siren = Array.isArray(registreRaw)
      ? (registreRaw[0] ?? '')
      : (registreRaw ?? '');

    const regionCodeRaw = Array.isArray(record.region_code)
      ? (record.region_code[0] ?? this.regionCode)
      : (record.region_code ?? this.regionCode);

    return {
      siren: siren.replace(/\D/g, ''),
      dateParution: record.dateparution,
      // l'API renvoie parfois region_code en nombre flottant (84.0) : on
      // normalise en entier textuel ("84") pour rester coherent en base.
      regionCode: String(Math.trunc(Number(regionCodeRaw))),
      descriptifBrut: record.modificationsgenerales ?? '',
      commercant: record.commercant ?? '',
      tribunal: record.tribunal ?? '',
    };
  }

  private isoDateDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }
}
