import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export interface ProspectA11y {
  domaine: string;
  etapeAtteinte: string;
  siren?: string | null;
  statutSiren?: string | null;
  sourceUrlSiren?: string | null;
  nomComplet?: string | null;
  nafCode?: string | null;
  categorieEntreprise?: string | null;
  trancheEffectif?: string | null;
  ca?: number | null;
  anneeCa?: string | null;
  coherentAvecDomaine?: boolean | null;
  statutQualification?: string | null;
  statutDeclaration?: string | null;
  sourceUrlDeclaration?: string | null;
  scanTotalViolations?: number | null;
  scanTopViolations?: string | null; // JSON stringifie
}

/**
 * Stockage local du pipeline a11y, meme fichier SQLite que le mode Dev
 * (radar.sqlite) mais table dediee -- jamais committe (cf .gitignore
 * /data), meme decision que le reste : moteur public, donnees privees.
 */
@Injectable()
export class A11yStorageService implements OnModuleDestroy {
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
      CREATE TABLE IF NOT EXISTS a11y_prospects (
        domaine TEXT PRIMARY KEY,
        etape_atteinte TEXT NOT NULL,
        siren TEXT,
        statut_siren TEXT,
        source_url_siren TEXT,
        nom_complet TEXT,
        naf_code TEXT,
        categorie_entreprise TEXT,
        tranche_effectif TEXT,
        ca REAL,
        annee_ca TEXT,
        coherent_avec_domaine INTEGER,
        statut_qualification TEXT,
        statut_declaration TEXT,
        source_url_declaration TEXT,
        scan_total_violations INTEGER,
        scan_top_violations TEXT,
        traite_le TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  enregistrer(prospect: ProspectA11y): void {
    this.db
      .prepare(
        `INSERT INTO a11y_prospects
           (domaine, etape_atteinte, siren, statut_siren, source_url_siren, nom_complet,
            naf_code, categorie_entreprise, tranche_effectif, ca, annee_ca,
            coherent_avec_domaine, statut_qualification, statut_declaration,
            source_url_declaration, scan_total_violations, scan_top_violations, traite_le)
         VALUES
           (@domaine, @etapeAtteinte, @siren, @statutSiren, @sourceUrlSiren, @nomComplet,
            @nafCode, @categorieEntreprise, @trancheEffectif, @ca, @anneeCa,
            @coherentAvecDomaine, @statutQualification, @statutDeclaration,
            @sourceUrlDeclaration, @scanTotalViolations, @scanTopViolations, datetime('now'))
         ON CONFLICT(domaine) DO UPDATE SET
           etape_atteinte = excluded.etape_atteinte,
           siren = excluded.siren,
           statut_siren = excluded.statut_siren,
           source_url_siren = excluded.source_url_siren,
           nom_complet = excluded.nom_complet,
           naf_code = excluded.naf_code,
           categorie_entreprise = excluded.categorie_entreprise,
           tranche_effectif = excluded.tranche_effectif,
           ca = excluded.ca,
           annee_ca = excluded.annee_ca,
           coherent_avec_domaine = excluded.coherent_avec_domaine,
           statut_qualification = excluded.statut_qualification,
           statut_declaration = excluded.statut_declaration,
           source_url_declaration = excluded.source_url_declaration,
           scan_total_violations = excluded.scan_total_violations,
           scan_top_violations = excluded.scan_top_violations,
           traite_le = datetime('now')`,
      )
      .run({
        domaine: prospect.domaine,
        etapeAtteinte: prospect.etapeAtteinte,
        siren: prospect.siren ?? null,
        statutSiren: prospect.statutSiren ?? null,
        sourceUrlSiren: prospect.sourceUrlSiren ?? null,
        nomComplet: prospect.nomComplet ?? null,
        nafCode: prospect.nafCode ?? null,
        categorieEntreprise: prospect.categorieEntreprise ?? null,
        trancheEffectif: prospect.trancheEffectif ?? null,
        ca: prospect.ca ?? null,
        anneeCa: prospect.anneeCa ?? null,
        coherentAvecDomaine:
          prospect.coherentAvecDomaine === null || prospect.coherentAvecDomaine === undefined
            ? null
            : prospect.coherentAvecDomaine
              ? 1
              : 0,
        statutQualification: prospect.statutQualification ?? null,
        statutDeclaration: prospect.statutDeclaration ?? null,
        sourceUrlDeclaration: prospect.sourceUrlDeclaration ?? null,
        scanTotalViolations: prospect.scanTotalViolations ?? null,
        scanTopViolations: prospect.scanTopViolations ?? null,
      });
  }

  dejaTraite(domaine: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM a11y_prospects WHERE domaine = ?`)
      .get(domaine);
    return !!row;
  }

  /** Prospects reellement exploitables : declaration absente/non conforme, pas suspects. */
  listerProspectsQualifies(limit = 100) {
    return this.db
      .prepare(
        `SELECT domaine, siren, nom_complet as nomComplet, naf_code as nafCode,
                ca, statut_declaration as statutDeclaration,
                source_url_declaration as sourceUrlDeclaration,
                scan_total_violations as scanTotalViolations,
                scan_top_violations as scanTopViolations
         FROM a11y_prospects
         WHERE statut_qualification = 'qualifie'
           AND statut_declaration IN ('absente', 'non_conforme', 'partiel')
         ORDER BY traite_le DESC
         LIMIT ?`,
      )
      .all(limit);
  }

  listerRecent(limit = 100) {
    return this.db
      .prepare(`SELECT * FROM a11y_prospects ORDER BY traite_le DESC LIMIT ?`)
      .all(limit);
  }

  onModuleDestroy(): void {
    this.db.close();
  }
}
