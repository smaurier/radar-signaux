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
  // presents seulement quand lus depuis listRecent (apres migration enrichissement)
  enrichi?: 0 | 1;
  nafCode?: string | null;
  sectionActivite?: string | null;
  categorieEntreprise?: string | null;
  trancheEffectif?: string | null;
  dateCreation?: string | null;
  // presents seulement quand lus depuis listRecent (apres migration INPI)
  inpiQualifie?: 0 | 1;
  inpiCapital?: number | null;
  inpiErreur?: string | null;
  // presents seulement quand lus depuis listRecent (apres migration actes)
  acteLu?: 0 | 1;
  acteSens?: 'hausse' | 'baisse' | null;
  acteCapitalAvant?: number | null;
  acteCapitalApres?: number | null;
  acteId?: string | null;
  acteErreur?: string | null;
}

export interface PresseConfirmation {
  source: string;
  url: string;
  titre: string;
}

export interface Enrichissement {
  nafCode: string | null;
  sectionActivite: string | null;
  categorieEntreprise: string | null;
  trancheEffectif: string | null;
  dateCreation: string | null;
}

export interface QualificationInpi {
  capital: number | null;
  erreur: string | null;
}

export interface LectureActe {
  sens: 'hausse' | 'baisse' | null;
  capitalAvant: number | null;
  capitalApres: number | null;
  acteId: string | null;
  erreur: string | null;
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
    addColumn(
      'presse_confirmee',
      'presse_confirmee INTEGER NOT NULL DEFAULT 0',
    );
    addColumn('presse_source', 'presse_source TEXT');
    addColumn('presse_url', 'presse_url TEXT');
    addColumn('presse_titre', 'presse_titre TEXT');
    addColumn('notifie_email', 'notifie_email INTEGER NOT NULL DEFAULT 0');
    addColumn('enrichi', 'enrichi INTEGER NOT NULL DEFAULT 0');
    addColumn('naf_code', 'naf_code TEXT');
    addColumn('section_activite', 'section_activite TEXT');
    addColumn('categorie_entreprise', 'categorie_entreprise TEXT');
    addColumn('tranche_effectif', 'tranche_effectif TEXT');
    addColumn('date_creation', 'date_creation TEXT');
    addColumn('inpi_qualifie', 'inpi_qualifie INTEGER NOT NULL DEFAULT 0');
    addColumn('inpi_capital', 'inpi_capital REAL');
    addColumn('inpi_erreur', 'inpi_erreur TEXT');
    addColumn('acte_lu', 'acte_lu INTEGER NOT NULL DEFAULT 0');
    addColumn('acte_sens', 'acte_sens TEXT');
    addColumn('acte_capital_avant', 'acte_capital_avant REAL');
    addColumn('acte_capital_apres', 'acte_capital_apres REAL');
    addColumn('acte_id', 'acte_id TEXT');
    addColumn('acte_erreur', 'acte_erreur TEXT');
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
                presse_url as presseUrl, presse_titre as presseTitre,
                enrichi, naf_code as nafCode, section_activite as sectionActivite,
                categorie_entreprise as categorieEntreprise,
                tranche_effectif as trancheEffectif, date_creation as dateCreation,
                inpi_qualifie as inpiQualifie, inpi_capital as inpiCapital,
                inpi_erreur as inpiErreur,
                acte_lu as acteLu, acte_sens as acteSens,
                acte_capital_avant as acteCapitalAvant, acte_capital_apres as acteCapitalApres,
                acte_id as acteId, acte_erreur as acteErreur
         FROM bodacc_signaux
         ORDER BY date_parution DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows as BodaccSignal[];
  }

  /** Signaux jamais encore qualifies via l'API INPI (capital social). */
  listUnqualifiedByInpi(limit = 500): BodaccSignal[] {
    const rows = this.db
      .prepare(
        `SELECT siren, date_parution as dateParution, region_code as regionCode,
                descriptif_brut as descriptifBrut, commercant, tribunal
         FROM bodacc_signaux
         WHERE inpi_qualifie = 0
         ORDER BY date_parution DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows as BodaccSignal[];
  }

  markQualifiedByInpi(
    siren: string,
    dateParution: string,
    qualification: QualificationInpi,
  ): void {
    this.db
      .prepare(
        `UPDATE bodacc_signaux
         SET inpi_qualifie = 1, inpi_capital = @capital, inpi_erreur = @erreur
         WHERE siren = @siren AND date_parution = @dateParution`,
      )
      .run({ siren, dateParution, ...qualification });
  }

  /**
   * Signaux jamais encore passes par la lecture d'acte (etape lourde :
   * telechargement + parsing PDF). Limite par defaut plus basse que les
   * autres etapes (traitement plus couteux en temps/reseau).
   */
  listSignauxSansActeLu(limit = 100): BodaccSignal[] {
    const rows = this.db
      .prepare(
        `SELECT siren, date_parution as dateParution, region_code as regionCode,
                descriptif_brut as descriptifBrut, commercant, tribunal
         FROM bodacc_signaux
         WHERE acte_lu = 0
         ORDER BY date_parution DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows as BodaccSignal[];
  }

  markActeLu(siren: string, dateParution: string, lecture: LectureActe): void {
    this.db
      .prepare(
        `UPDATE bodacc_signaux
         SET acte_lu = 1, acte_sens = @sens, acte_capital_avant = @capitalAvant,
             acte_capital_apres = @capitalApres, acte_id = @acteId, acte_erreur = @erreur
         WHERE siren = @siren AND date_parution = @dateParution`,
      )
      .run({ siren, dateParution, ...lecture });
  }

  /** Signaux jamais encore enrichis (NAF/secteur), candidats a l'appel API. */
  listUnenriched(limit = 500): BodaccSignal[] {
    const rows = this.db
      .prepare(
        `SELECT siren, date_parution as dateParution, region_code as regionCode,
                descriptif_brut as descriptifBrut, commercant, tribunal
         FROM bodacc_signaux
         WHERE enrichi = 0
         ORDER BY date_parution DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows as BodaccSignal[];
  }

  markEnriched(
    siren: string,
    dateParution: string,
    enrichissement: Enrichissement,
  ): void {
    this.db
      .prepare(
        `UPDATE bodacc_signaux
         SET enrichi = 1, naf_code = @nafCode, section_activite = @sectionActivite,
             categorie_entreprise = @categorieEntreprise,
             tranche_effectif = @trancheEffectif, date_creation = @dateCreation
         WHERE siren = @siren AND date_parution = @dateParution`,
      )
      .run({ siren, dateParution, ...enrichissement });
  }

  /** Signaux pas encore confirmes par la presse, candidats au matching RSS. */
  listUnconfirmedByPresse(limit = 500): BodaccSignal[] {
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

  /** Signaux jamais encore inclus dans un digest email. */
  listUnnotified(limit = 500): BodaccSignal[] {
    const rows = this.db
      .prepare(
        `SELECT siren, date_parution as dateParution, region_code as regionCode,
                descriptif_brut as descriptifBrut, commercant, tribunal,
                presse_confirmee as presseConfirmee, presse_source as presseSource,
                presse_url as presseUrl, presse_titre as presseTitre,
                enrichi, naf_code as nafCode, section_activite as sectionActivite,
                categorie_entreprise as categorieEntreprise,
                tranche_effectif as trancheEffectif, date_creation as dateCreation,
                inpi_qualifie as inpiQualifie, inpi_capital as inpiCapital,
                inpi_erreur as inpiErreur,
                acte_lu as acteLu, acte_sens as acteSens,
                acte_capital_avant as acteCapitalAvant, acte_capital_apres as acteCapitalApres,
                acte_id as acteId, acte_erreur as acteErreur
         FROM bodacc_signaux
         WHERE notifie_email = 0
         ORDER BY date_parution DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows as BodaccSignal[];
  }

  markNotified(signals: Pick<BodaccSignal, 'siren' | 'dateParution'>[]): void {
    const update = this.db.prepare(
      `UPDATE bodacc_signaux SET notifie_email = 1
       WHERE siren = @siren AND date_parution = @dateParution`,
    );
    const transaction = this.db.transaction(
      (items: Pick<BodaccSignal, 'siren' | 'dateParution'>[]) => {
        for (const item of items) update.run(item);
      },
    );
    transaction(signals);
  }

  onModuleDestroy(): void {
    this.db.close();
  }
}
