import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { cheminJournal, journauxAPurger, Journal } from './journal';

/**
 * Acces disque du journal de run. Separe des fonctions pures de `journal.ts`
 * pour que la politique (dates, retention, forme du resume) reste testable
 * sans toucher au systeme de fichiers.
 *
 * La racine passee en argument est celle du depot `radar-signaux` : c'est son
 * inactivite que GitHub compte pour desactiver un workflow planifie, donc le
 * journal doit atterrir ici, pas dans le depot de donnees.
 */

/** Ecrit le journal du jour et rend son chemin relatif. */
export function ecrireJournal(
  racine: string,
  journal: Journal,
  maintenant: Date,
): string {
  const chemin = cheminJournal(maintenant);
  const complet = join(racine, chemin);
  mkdirSync(dirname(complet), { recursive: true });
  // Indente : ce fichier est relu par un humain dans un diff git.
  // Ecrase le journal du jour si le run est rejoue : un jour, un journal.
  writeFileSync(complet, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  return chemin;
}

/** Chemins relatifs de tous les fichiers sous `journal/`, barres obliques. */
export function listerJournaux(racine: string): string[] {
  const dossier = join(racine, 'journal');
  // Pas encore de dossier journal : rien a lister, ce n'est pas une erreur.
  // Teste plutot qu'attrape, pour laisser `readdirSync` garder son typage
  // `Dirent[]` (une annotation explicite forcait la surcharge Buffer).
  if (!existsSync(dossier)) {
    return [];
  }

  return readdirSync(dossier, { recursive: true, withFileTypes: true })
    .filter((entree) => entree.isFile())
    .map((entree) =>
      relative(racine, join(entree.parentPath, entree.name))
        .split(sep)
        .join('/'),
    );
}

/**
 * Supprime les journaux plus vieux que la retention et rend la liste des
 * chemins supprimes. Un fichier dont le nom ne porte pas une date lisible est
 * ignore, jamais supprime.
 */
export function purgerJournaux(racine: string, maintenant: Date): string[] {
  const aSupprimer = journauxAPurger(listerJournaux(racine), maintenant);

  for (const chemin of aSupprimer) {
    rmSync(join(racine, chemin), { force: true });
  }

  return aSupprimer;
}
