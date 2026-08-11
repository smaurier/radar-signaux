import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export interface BodaccSignal {
  siren: string;
  dateParution: string;
  regionCode: string;
  descriptifBrut: string;
  commercant: string;
  tribunal: string;
}

/**
 * Stockage local SQLite, jamais committe (cf .gitignore /data) : la donnee
 * (SIREN, entreprises detectees) reste privee, seul le moteur est public
 * (decision du 01/08, cf memory/project_radar_signaux.md).
 */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly db: Database.Database;

  constructor() {
    const dbPath =
      process.env.RADAR_DB_PATH ?? join(process.cwd(), 'data', 'radar.sqlite');
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bodacc_signaux (
        siren TEXT NOT NULL,
        date_parution TEXT NOT NULL,
        region_code TEXT NOT NULL,
        descriptif_brut TEXT NOT NULL,
        commercant TEXT NOT NULL,
        tribunal TEXT NOT NULL,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (siren, date_parution)
      );
    `);
  }

  /**
   * Insere les signaux inconnus, ignore les doublons (meme siren + meme
   * date de parution deja vus). Retourne uniquement les signaux nouveaux
   * pour cette execution.
   */
  upsertNewSignals(signals: BodaccSignal[]): BodaccSignal[] {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO bodacc_signaux
        (siren, date_parution, region_code, descriptif_brut, commercant, tribunal)
      VALUES (@siren, @dateParution, @regionCode, @descriptifBrut, @commercant, @tribunal)
    `);

    const nouveaux: BodaccSignal[] = [];
    const transaction = this.db.transaction((items: BodaccSignal[]) => {
      for (const item of items) {
        const result = insert.run(item);
        if (result.changes > 0) {
          nouveaux.push(item);
        }
      }
    });
    transaction(signals);
    return nouveaux;
  }

  listRecent(limit = 50): BodaccSignal[] {
    const rows = this.db
      .prepare(
        `SELECT siren, date_parution as dateParution, region_code as regionCode,
                descriptif_brut as descriptifBrut, commercant, tribunal
         FROM bodacc_signaux
         ORDER BY date_parution DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows as BodaccSignal[];
  }

  onModuleDestroy(): void {
    this.db.close();
  }
}
