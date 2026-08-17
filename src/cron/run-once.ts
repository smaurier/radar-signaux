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

  for (const [nom, executer] of etapes) {
    console.log(`\n=== ${nom} ===`);
    const debut = Date.now();
    try {
      await executer();
    } catch (err) {
      console.error(
        `Etape "${nom}" en echec, on continue quand meme :`,
        (err as Error).message,
      );
    }
    console.log(`(${Math.round((Date.now() - debut) / 1000)}s)`);
  }

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('run-once : erreur fatale', err);
  process.exit(1);
});
