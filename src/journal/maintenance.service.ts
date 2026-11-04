import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { POLITIQUE_RETENTION, ReglePurge } from './journal';

/**
 * Menage inter-tables de la base : purge selon la politique de retention, et
 * les deux mesures que le journal de run publie (nombre de lignes par table,
 * taille du fichier).
 *
 * Pourquoi un service a part plutot qu'une methode de `StorageService` : la
 * purge touche `a11y_prospects`, que `StorageService` ne possede pas (elle est
 * creee par `A11yStorageService`). Les deux services ouvrent deja le MEME
 * fichier SQLite via `RADAR_DB_PATH`, chacun avec sa connexion. Ce service
 * assume donc explicitement le role transversal, au lieu de le cacher dans un
 * service centre sur BODACC.
 */
@Injectable()
export class MaintenanceService {
  private readonly db: Database.Database;
  private readonly cheminBase: string;

  constructor() {
    this.cheminBase =
      process.env.RADAR_DB_PATH ?? join(process.cwd(), 'data', 'radar.sqlite');
    const dossier = dirname(this.cheminBase);
    if (!existsSync(dossier)) {
      mkdirSync(dossier, { recursive: true });
    }
    this.db = new Database(this.cheminBase);
  }

  /**
   * Purge les lignes plus vieilles que la politique et rend le compte par
   * table. Une table absente compte 0 : les deux tables sont creees par deux
   * services differents, donc un run qui n'a jamais atteint l'etape a11y peut
   * tourner sur une base ou `a11y_prospects` n'existe pas. La purge ne doit
   * jamais faire tomber le run pour ca.
   */
  purger(
    maintenant: Date,
    politique: readonly ReglePurge[] = POLITIQUE_RETENTION,
  ): Record<string, number> {
    const comptes: Record<string, number> = {};

    for (const regle of politique) {
      if (!this.tableExiste(regle.table)) {
        comptes[regle.table] = 0;
        continue;
      }

      const limite = horodatageSqlite(maintenant, regle.jours);
      const resultat = this.db
        .prepare(`DELETE FROM "${regle.table}" WHERE "${regle.colonne}" < ?`)
        .run(limite);
      comptes[regle.table] = resultat.changes;
    }

    return comptes;
  }

  compterLignes(tables: readonly string[]): Record<string, number> {
    const comptes: Record<string, number> = {};

    for (const table of tables) {
      if (!this.tableExiste(table)) {
        comptes[table] = 0;
        continue;
      }
      const ligne = this.db
        .prepare(`SELECT count(*) AS total FROM "${table}"`)
        .get() as { total: number };
      comptes[table] = ligne.total;
    }

    return comptes;
  }

  octetsBase(): number {
    return existsSync(this.cheminBase) ? statSync(this.cheminBase).size : 0;
  }

  fermer(): void {
    this.db.close();
  }

  private tableExiste(table: string): boolean {
    const trouve = this.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(table);
    return trouve !== undefined;
  }
}

/**
 * Horodatage au format de `datetime('now')` en SQLite : `AAAA-MM-JJ HH:MM:SS`,
 * un espace et non un T. C'est ce format que portent `first_seen_at` et
 * `traite_le`, et c'est lui qui rend la comparaison lexicographique juste.
 */
function horodatageSqlite(maintenant: Date, joursEnArriere: number): string {
  const limite = new Date(
    maintenant.getTime() - joursEnArriere * 24 * 60 * 60 * 1000,
  );
  return limite.toISOString().replace('T', ' ').slice(0, 19);
}
