import { writeFileSync } from 'node:fs';
import { StorageService } from '../storage/storage.service';

/**
 * Lecture des articles, premiere etape (CI, apres run-once) : ecrit la liste
 * des articles que Claude doit lire. Le nombre est borne pour menager le quota
 * de l'abonnement ; le reste attend le passage suivant.
 *
 * Instancie StorageService a la main : il n'a aucune dependance, et un script
 * d'une etape n'a pas besoin du conteneur Nest.
 */
const LIMITE = Number(process.env.LEVEES_LECTURES_MAX ?? 15);
const fichier = process.argv[2] ?? 'a-lire.json';

const storage = new StorageService();
try {
  const articles = storage.articlesALire(LIMITE);
  writeFileSync(fichier, `${JSON.stringify(articles, null, 2)}\n`, 'utf8');
  console.log(`${articles.length} article(s) a lire, ecrit(s) dans ${fichier}`);
} finally {
  storage.onModuleDestroy();
}
