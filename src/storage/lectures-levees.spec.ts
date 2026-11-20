import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArticlePresse } from '../levees/article-presse';
import { StorageService } from './storage.service';

/** Sur une vraie base SQLite temporaire, comme le reste du stockage. */
describe('StorageService, lecture des articles de levee', () => {
  let dossier: string;
  let cheminBase: string;
  let storage: StorageService;

  const article = (
    url: string,
    source = 'maddyness',
    publieLe = '2026-11-17T08:00:00.000Z',
  ): ArticlePresse => ({
    url,
    source,
    publieLe,
    titre: `Titre de ${url}`,
    genre: null,
    nom: null,
    montant: null,
    devise: null,
  });

  beforeEach(() => {
    dossier = mkdtempSync(join(tmpdir(), 'radar-lectures-'));
    cheminBase = join(dossier, 'radar.sqlite');
    process.env.RADAR_DB_PATH = cheminBase;
  });

  afterEach(() => {
    storage?.onModuleDestroy();
    delete process.env.RADAR_DB_PATH;
    rmSync(dossier, { recursive: true, force: true });
  });

  describe('articlesALire', () => {
    beforeEach(() => {
      storage = new StorageService();
    });

    it('rend les articles Maddyness pas encore lus, les plus recents en premier', () => {
      storage.enregistrerArticles([
        article('https://m.fr/ancien', 'maddyness', '2026-11-10T08:00:00Z'),
        article('https://m.fr/recent', 'maddyness', '2026-11-18T08:00:00Z'),
      ]);

      expect(storage.articlesALire(10)).toEqual([
        { url: 'https://m.fr/recent', titre: 'Titre de https://m.fr/recent' },
        { url: 'https://m.fr/ancien', titre: 'Titre de https://m.fr/ancien' },
      ]);
    });

    it("ne rend jamais un article FrenchWeb : son robots.txt refuse les robots d'IA", () => {
      storage.enregistrerArticles([article('https://f.fr/a', 'frenchweb')]);

      expect(storage.articlesALire(10)).toEqual([]);
    });

    it('respecte la limite demandee', () => {
      storage.enregistrerArticles([
        article('https://m.fr/a'),
        article('https://m.fr/b'),
        article('https://m.fr/c'),
      ]);

      expect(storage.articlesALire(2)).toHaveLength(2);
    });

    it('abandonne un article au bout de 3 tentatives sans lecture : il ne consomme pas le quota indefiniment', () => {
      storage.enregistrerArticles([article('https://m.fr/a')]);

      storage.articlesALire(10);
      storage.articlesALire(10);
      storage.articlesALire(10);

      expect(storage.articlesALire(10)).toEqual([]);
    });

    it("ne compte pas une tentative quand la lecture n'a pas tourne du tout (jeton, quota) : ce n'est pas la faute de l'article", () => {
      storage.enregistrerArticles([article('https://m.fr/a')]);

      for (let passage = 0; passage < 5; passage++) {
        storage.articlesALire(10);
        storage.annulerTentatives(['https://m.fr/a']);
      }

      expect(storage.articlesALire(10)).toEqual([
        { url: 'https://m.fr/a', titre: 'Titre de https://m.fr/a' },
      ]);
    });
  });

  describe('enregistrerLecture', () => {
    beforeEach(() => {
      storage = new StorageService();
      storage.enregistrerArticles([article('https://m.fr/a')]);
    });

    it("enregistre les levees lues et ne propose plus l'article", () => {
      storage.enregistrerLecture({
        url: 'https://m.fr/a',
        genre: 'levee',
        levees: [
          {
            nom: 'Kestrel',
            montant: 4_000_000,
            devise: 'EUR',
            recrutement: true,
            resumeRecrutement: 'Renforcer les équipes produit.',
          },
        ],
      });

      expect(storage.articlesALire(10)).toEqual([]);
      expect(storage.leveesLues()).toEqual([
        {
          articleUrl: 'https://m.fr/a',
          nom: 'Kestrel',
          montant: 4_000_000,
          devise: 'EUR',
          recrutement: true,
          resumeRecrutement: 'Renforcer les équipes produit.',
        },
      ]);
    });

    it('marque lu un article sans levee, sans rien ajouter aux levees', () => {
      storage.enregistrerLecture({
        url: 'https://m.fr/a',
        genre: 'sans_levee',
        levees: [],
      });

      expect(storage.articlesALire(10)).toEqual([]);
      expect(storage.leveesLues()).toEqual([]);
    });
  });

  it('ajoute les colonnes de lecture a une table creee avant elles (base de production du 20/11)', () => {
    const ancienne = new Database(cheminBase);
    ancienne.exec(`
      CREATE TABLE articles_presse (
        url TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        publie_le TEXT,
        titre TEXT NOT NULL,
        genre TEXT,
        nom TEXT,
        montant REAL,
        devise TEXT,
        vu_le TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO articles_presse (url, source, publie_le, titre)
        VALUES ('https://m.fr/existant', 'maddyness', '2026-11-20T08:00:00Z', 'Existant');
    `);
    ancienne.close();

    storage = new StorageService();

    expect(storage.articlesALire(10)).toEqual([
      { url: 'https://m.fr/existant', titre: 'Existant' },
    ]);
  });
});
