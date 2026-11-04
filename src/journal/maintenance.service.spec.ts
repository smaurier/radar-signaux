import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaintenanceService } from './maintenance.service';

/**
 * Tests sur une vraie base SQLite temporaire, pas sur un double : la purge est
 * entierement du SQL, un faux ne prouverait rien. Les DDL reproduisent les
 * seules colonnes qui comptent ici, avec le meme format d'horodatage que
 * `datetime('now')` (espace entre la date et l'heure, pas un T) -- c'est ce
 * format qui rend la comparaison lexicographique juste.
 */
describe('MaintenanceService', () => {
  let dossier: string;
  let cheminBase: string;
  const maintenant = new Date('2026-11-04T07:00:00Z');

  const creerBase = (): Database.Database => {
    const db = new Database(cheminBase);
    db.exec(`
      CREATE TABLE bodacc_signaux (
        siren TEXT NOT NULL,
        date_parution TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        PRIMARY KEY (siren, date_parution)
      );
      CREATE TABLE a11y_prospects (
        domaine TEXT PRIMARY KEY,
        traite_le TEXT NOT NULL
      );
    `);
    return db;
  };

  beforeEach(() => {
    dossier = mkdtempSync(join(tmpdir(), 'radar-maintenance-'));
    cheminBase = join(dossier, 'radar.sqlite');
    process.env.RADAR_DB_PATH = cheminBase;
  });

  afterEach(() => {
    delete process.env.RADAR_DB_PATH;
    rmSync(dossier, { recursive: true, force: true });
  });

  it('supprime les signaux BODACC de plus de 3 mois et garde les recents', () => {
    const db = creerBase();
    db.prepare(`INSERT INTO bodacc_signaux VALUES (?, ?, ?)`).run(
      '111111111',
      '2026-07-01',
      '2026-07-01 10:00:00',
    );
    db.prepare(`INSERT INTO bodacc_signaux VALUES (?, ?, ?)`).run(
      '222222222',
      '2026-10-20',
      '2026-10-20 10:00:00',
    );
    db.close();

    const service = new MaintenanceService();
    const purge = service.purger(maintenant);
    const restants = service.compterLignes(['bodacc_signaux']);
    service.fermer();

    expect(purge['bodacc_signaux']).toBe(1);
    expect(restants['bodacc_signaux']).toBe(1);
  });

  it('garde les prospects a11y un an, pas trois mois', () => {
    const db = creerBase();
    const insert = db.prepare(`INSERT INTO a11y_prospects VALUES (?, ?)`);
    insert.run('vieux.fr', '2025-01-01 09:00:00');
    // Six mois : purge si on appliquait par erreur la regle des 3 mois.
    insert.run('encore-bon.fr', '2026-05-01 09:00:00');
    db.close();

    const service = new MaintenanceService();
    const purge = service.purger(maintenant);
    const restants = service.compterLignes(['a11y_prospects']);
    service.fermer();

    expect(purge['a11y_prospects']).toBe(1);
    expect(restants['a11y_prospects']).toBe(1);
  });

  it('ne supprime rien quand tout est dans les delais', () => {
    const db = creerBase();
    db.prepare(`INSERT INTO bodacc_signaux VALUES (?, ?, ?)`).run(
      '333333333',
      '2026-11-01',
      '2026-11-01 08:00:00',
    );
    db.close();

    const service = new MaintenanceService();
    const purge = service.purger(maintenant);
    service.fermer();

    expect(purge['bodacc_signaux']).toBe(0);
  });

  it('ignore une table absente au lieu d echouer', () => {
    // Les deux tables sont creees par deux services differents. Un run qui
    // n'a jamais atteint l'etape a11y peut donc tourner sur une base ou
    // a11y_prospects n'existe pas : la purge ne doit pas faire tomber le run.
    const db = new Database(cheminBase);
    db.exec(`
      CREATE TABLE bodacc_signaux (
        siren TEXT NOT NULL,
        date_parution TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        PRIMARY KEY (siren, date_parution)
      );
    `);
    db.close();

    const service = new MaintenanceService();
    const purge = service.purger(maintenant);
    service.fermer();

    expect(purge['a11y_prospects']).toBe(0);
    expect(purge['bodacc_signaux']).toBe(0);
  });

  it('compte 0 pour une table absente, sans lever', () => {
    const db = new Database(cheminBase);
    db.exec(
      `CREATE TABLE bodacc_signaux (siren TEXT, date_parution TEXT, first_seen_at TEXT);`,
    );
    db.close();

    const service = new MaintenanceService();
    const tailles = service.compterLignes(['bodacc_signaux', 'a11y_prospects']);
    service.fermer();

    expect(tailles).toEqual({ bodacc_signaux: 0, a11y_prospects: 0 });
  });

  it('rapporte la taille du fichier de base, pour le journal', () => {
    const db = creerBase();
    db.close();

    const service = new MaintenanceService();
    const octets = service.octetsBase();
    service.fermer();

    expect(octets).toBeGreaterThan(0);
  });
});
