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
  // presents seulement quand lus depuis listRecent (apres migration presse)
  presseConfirmee?: 0 | 1;
  presseSource?: string | null;
  presseUrl?: string | null;
  presseTitre?: string | null;
}

export interface PresseConfirmation {
  source: string;
  url: string;
  titre: string;
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

    // Colonnes de confirmation presse, ajoutees en migration additive (SQLite
    // n'a pas de ADD COLUMN IF NOT EXISTS) pour ne pas casser une base
    // existante creee avant ce champ.
    const existing = this.db
      .prepare(`PRAGMA table_info(bodacc_signaux)`)
      .all() as { name: string }[];
    const columns = new Set(existing.map((c) => c.name));

    const addColumn = (name: string, ddl: string) => {
      if (!columns.has(name)) {
        this.db.exec(`ALTER TABLE bodacc_signaux ADD COLUMN ${ddl}`);
      }
    };
    addColumn('presse_confirmee', 'presse_confirmee INTEGER NOT NULL DEFAULT 0');
    addColumn('presse_source', 'presse_source TEXT');
    addColumn('presse_url', 'presse_url TEXT');
    addColumn('presse_titre', 'presse_titre TEXT');
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
                descriptif_brut as descriptifBrut, commercant, tribunal,
                presse_confirmee as presseConfirmee, presse_source as presseSource,
                presse_url as presseUrl, presse_titre as presseTitre
         FROM bodacc_signaux
         ORDER BY date_parution DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows as BodaccSignal[];
  }

  /** Signaux pas encore confirmes par la presse, candidats au matching RSS. */
  listUnconfirmedByPresse(limit = 200): BodaccSignal[] {
    const rows = this.db
      .prepare(
        `SELECT siren, date_parution as dateParution, region_code as regionCode,
                descriptif_brut as descriptifBrut, commercant, tribunal
         FROM bodacc_signaux
         WHERE presse_confirmee = 0
         ORDER BY date_parution DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows as BodaccSignal[];
  }

  markConfirmedByPresse(
    siren: string,
    dateParution: string,
    confirmation: PresseConfirmation,
  ): void {
    this.db
      .prepare(
        `UPDATE bodacc_signaux
         SET presse_confirmee = 1, presse_source = @source, presse_url = @url,
             presse_titre = @titre
         WHERE siren = @siren AND date_parution = @dateParution`,
      )
      .run({ siren, dateParution, ...confirmation });
  }

  onModuleDestroy(): void {
    this.db.close();
  }
}
