import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArticlePresse } from '../levees/article-presse';
import { StorageService } from './storage.service';

/**
 * Sur une vraie base SQLite temporaire : la dedup repose sur la cle primaire
 * et un INSERT OR IGNORE, un double ne prouverait rien.
 */
describe('StorageService, articles de presse', () => {
  let dossier: string;
  let storage: StorageService;

  const article = (url: string): ArticlePresse => ({
    url,
    source: 'frenchweb',
    publieLe: '2026-11-17T08:00:00.000Z',
    titre: `Titre de ${url}`,
    genre: 'levee',
    nom: 'QUARTZ',
    montant: 4_700_000,
    devise: 'EUR',
  });

  beforeEach(() => {
    dossier = mkdtempSync(join(tmpdir(), 'radar-articles-'));
    process.env.RADAR_DB_PATH = join(dossier, 'radar.sqlite');
    storage = new StorageService();
  });

  afterEach(() => {
    storage.onModuleDestroy();
    delete process.env.RADAR_DB_PATH;
    rmSync(dossier, { recursive: true, force: true });
  });

  it('enregistre les articles inconnus et les rend', () => {
    const nouveaux = storage.enregistrerArticles([
      article('https://exemple.fr/a'),
      article('https://exemple.fr/b'),
    ]);

    expect(nouveaux.map((a) => a.url)).toEqual([
      'https://exemple.fr/a',
      'https://exemple.fr/b',
    ]);
  });

  it("ne rend pas un article deja vu : un flux couvre plusieurs jours, il revient d'un passage a l'autre", () => {
    storage.enregistrerArticles([article('https://exemple.fr/a')]);

    const nouveaux = storage.enregistrerArticles([
      article('https://exemple.fr/a'),
      article('https://exemple.fr/c'),
    ]);

    expect(nouveaux.map((a) => a.url)).toEqual(['https://exemple.fr/c']);
  });
});
