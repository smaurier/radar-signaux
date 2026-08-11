import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StorageService, BodaccSignal } from '../storage/storage.service';
import { BodaccApiResponse } from './bodacc.types';

const BODACC_API_URL =
  'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';

/**
 * Collecteur BODACC (mode Dev) : detecte les modifications de capital
 * publiees au BODACC pour une region donnee. Signal "dur" (greffe -> RNE ->
 * BODACC), gratuit, sans cle, quota anonyme largement suffisant pour un
 * cron quotidien. Cf etude private/research/radar-signaux-faisabilite-2026-08.md.
 *
 * Le BODACC ne donne plus le sens (hausse/baisse) ni le montant depuis le
 * guichet unique (2023) : ce collecteur produit des CANDIDATS a qualifier
 * (etape INPI, hors MVP V1), pas des levees confirmees.
 */
@Injectable()
export class BodaccService {
  private readonly logger = new Logger(BodaccService.name);
  private readonly regionCode = process.env.BODACC_REGION_CODE ?? '84'; // 84 = AURA
  private readonly lookbackDays = Number(process.env.BODACC_LOOKBACK_DAYS ?? 7);

  constructor(private readonly storage: StorageService) {}

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async runDaily(): Promise<void> {
    await this.run();
  }

  /** Interroge le BODACC et stocke les nouveaux signaux. Retourne les nouveaux. */
  async run(): Promise<BodaccSignal[]> {
    const records = await this.fetchRecords();
    const signals = records.map((r) => this.toSignal(r));
    const nouveaux = this.storage.upsertNewSignals(signals);
    this.logger.log(
      `BODACC : ${records.length} annonce(s) recue(s), ${nouveaux.length} nouvelle(s) (region ${this.regionCode}, ${this.lookbackDays}j).`,
    );
    return nouveaux;
  }

  private async fetchRecords() {
    const since = this.isoDateDaysAgo(this.lookbackDays);
    const where = `modificationsgenerales like "capital" AND region_code="${this.regionCode}" AND dateparution>="${since}"`;

    const params = new URLSearchParams({
      where,
      select:
        'dateparution,commercant,registre,region_code,tribunal,modificationsgenerales',
      order_by: 'dateparution desc',
      limit: '100',
    });

    const url = `${BODACC_API_URL}?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Appel BODACC en echec (${response.status} ${response.statusText})`,
      );
    }
    const body = (await response.json()) as BodaccApiResponse;
    return body.results ?? [];
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
