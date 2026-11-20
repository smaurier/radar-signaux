import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cheminJournal, Journal } from '../journal/journal';
import { ajouterAuJournal, preparerImport } from '../levees/import-lectures';
import { StorageService } from '../storage/storage.service';

/**
 * Lecture des articles, derniere etape (CI) : valide le fichier ecrit par
 * Claude contre le contrat de `lecture-article.ts`, enregistre ce qui passe,
 * et consigne le bilan dans le journal du jour (ecrit plus tot par run-once).
 * Un fichier absent alors que des articles etaient demandes devient un echec
 * visible du journal : c'est ainsi qu'un jeton expire ou un quota atteint se
 * voit.
 */
const [aLire = 'a-lire.json', lectures = 'lectures.json'] =
  process.argv.slice(2);

const { valides, bilan } = preparerImport(
  readFileSync(aLire, 'utf8'),
  existsSync(lectures) ? readFileSync(lectures, 'utf8') : null,
);

const storage = new StorageService();
try {
  for (const lecture of valides) storage.enregistrerLecture(lecture);
} finally {
  storage.onModuleDestroy();
}

console.log(
  `Lecture : ${bilan.lues}/${bilan.demandes} article(s) lu(s), ` +
    `${bilan.levees} levee(s), ${bilan.rejets.length} rejet(s)` +
    (bilan.fichierAbsent ? ', aucun fichier de lectures' : ''),
);
for (const rejet of bilan.rejets) {
  console.warn(`Rejete : ${rejet.url ?? 'fichier'} (${rejet.raison})`);
}

const journal = join(process.cwd(), cheminJournal(new Date()));
if (existsSync(journal)) {
  const avant = JSON.parse(readFileSync(journal, 'utf8')) as Journal;
  writeFileSync(
    journal,
    `${JSON.stringify(ajouterAuJournal(avant, bilan), null, 2)}\n`,
    'utf8',
  );
} else {
  console.warn(`Pas de journal du jour (${journal}) : bilan non consigne.`);
}
