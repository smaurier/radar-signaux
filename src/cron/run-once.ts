import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BodaccService } from '../bodacc/bodacc.service';
import { EntreprisesService } from '../entreprises/entreprises.service';
import { InpiService } from '../inpi/inpi.service';
import { InpiActesService } from '../inpi/inpi-actes.service';
import { PresseService } from '../presse/presse.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PipelineService } from '../a11y/pipeline/pipeline.service';
import { A11yNotificationsService } from '../a11y/notifications/a11y-notifications.service';
import {
  construireJournal,
  verifierInvariantRetention,
  POLITIQUE_RETENTION,
  EtapeExecutee,
} from '../journal/journal';
import { ecrireJournal, purgerJournaux } from '../journal/journal-fichiers';
import { MaintenanceService } from '../journal/maintenance.service';

try {
  process.loadEnvFile();
} catch {
  // pas de .env present (cas normal en CI : les secrets viennent de l'environnement)
}

/**
 * Point d'entree "run-once" pour l'execution en CI (GitHub Actions,
 * cf .github/workflows/cron.yml) : execute toute la sequence quotidienne
 * SEQUENTIELLEMENT (chaque etape attend la fin de la precedente) puis
 * quitte -- pas de serveur HTTP, pas de ScheduleModule/@Cron qui
 * attendent un creneau horaire.
 *
 * Corrige par construction le risque de chevauchement trouve le 11/08
 * en process persistant (creneaux fixes 7h/7h05/7h10/.../8h -- bug reel :
 * InpiService/InpiActesService s'etaient retrouves sans @Cron du tout,
 * et sur un gros volume les etapes en amont pouvaient deborder sur le
 * creneau suivant). Ici il n'y a plus de creneaux : l'etape N+1 ne
 * demarre jamais avant que l'etape N soit terminee.
 *
 * Une etape en echec n'interrompt pas les suivantes (continue quand
 * meme, log l'erreur) -- coherent avec le comportement deja adopte
 * partout ailleurs dans le code (jamais bloquer tout le run pour un
 * signal individuel en echec).
 */
async function main() {
  // Echoue AVANT tout traitement si la fenetre de collecte s'est rapprochee de
  // la retention : purger une ligne reautorise son retraitement, donc une
  // fenetre trop large remettrait des signaux deja notifies dans le circuit.
  // Mieux vaut un run rouge qu'une volee de mails en double.
  verifierInvariantRetention(Number(process.env.BODACC_LOOKBACK_DAYS ?? 7));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const etapes: Array<[string, () => Promise<unknown>]> = [
    ['BODACC (detection)', () => app.get(BodaccService).run()],
    ['Enrichissement NAF', () => app.get(EntreprisesService).run()],
    ['Qualification INPI (capital)', () => app.get(InpiService).run()],
    ['Confirmation presse', () => app.get(PresseService).run()],
    [
      'Lecture actes INPI (sens/montant)',
      () => app.get(InpiActesService).run(),
    ],
    ['Digest email mode Dev', () => app.get(NotificationsService).run()],
    ['Pipeline a11y (lot CrUX)', () => app.get(PipelineService).traiterLot()],
    ['Digest email mode a11y', () => app.get(A11yNotificationsService).run()],
  ];

  const executees: EtapeExecutee[] = [];

  for (const [nom, executer] of etapes) {
    console.log(`\n=== ${nom} ===`);
    const debut = Date.now();
    let echec: string | undefined;
    try {
      await executer();
    } catch (err) {
      echec = (err as Error).message;
      console.error(`Etape "${nom}" en echec, on continue quand meme :`, echec);
    }
    const dureeMs = Date.now() - debut;
    executees.push({ nom, dureeMs, ...(echec !== undefined ? { echec } : {}) });
    console.log(`(${Math.round(dureeMs / 1000)}s)`);
  }

  ecrireLeJournal(executees);

  await app.close();
  process.exit(0);
}

/**
 * Purge selon la retention, puis ecrit le resume du run dans ce depot.
 *
 * Deux effets voulus : une trace durable de ce que le radar a sorti (le log
 * Actions, lui, est efface au bout d'un temps), et une activite quotidienne
 * dans le depot de CODE, qui empeche GitHub de desactiver le workflow planifie
 * pour inactivite (ce qui est arrive le 16/10/2026, cron muet 18 jours).
 *
 * Le cablage est volontairement mince : toute la logique est dans `src/journal`
 * et testee la. Une erreur ici ne doit jamais faire echouer un run dont le
 * travail utile est deja fait, d'ou le try/catch.
 */
function ecrireLeJournal(executees: EtapeExecutee[]): void {
  console.log('\n=== Journal du run et purge ===');
  // Instancie directement : ce service n'a aucune dependance, et le faire vivre
  // hors du conteneur Nest evite de toucher AppModule pour un script.
  const maintenance = new MaintenanceService();
  try {
    const maintenant = new Date();
    const tables = POLITIQUE_RETENTION.map((regle) => regle.table);

    const purge = maintenance.purger(maintenant);
    const journal = construireJournal({
      maintenant,
      declencheur: process.env.GITHUB_EVENT_NAME ?? 'local',
      etapes: executees,
      purge,
      tailles: maintenance.compterLignes(tables),
      octetsBase: maintenance.octetsBase(),
    });

    const chemin = ecrireJournal(process.cwd(), journal, maintenant);
    const journauxSupprimes = purgerJournaux(process.cwd(), maintenant);

    console.log(
      `Journal ecrit dans ${chemin} ; purge ${JSON.stringify(purge)} ; ` +
        `${journauxSupprimes.length} journal(aux) de plus d'un an supprime(s).`,
    );
  } catch (err) {
    console.error(
      'Journal du run en echec, le travail du run reste valide :',
      (err as Error).message,
    );
  } finally {
    maintenance.fermer();
  }
}

main().catch((err) => {
  console.error('run-once : erreur fatale', err);
  process.exit(1);
});
