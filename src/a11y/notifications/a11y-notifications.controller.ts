import { Controller, Post } from '@nestjs/common';
import { A11yNotificationsService } from './a11y-notifications.service';

@Controller('a11y/notifications')
export class A11yNotificationsController {
  constructor(private readonly notifications: A11yNotificationsService) {}

  /** Declenche l'envoi immediat du digest, utile pour valider en dev. */
  @Post('run')
  async run() {
    const envoyes = await this.notifications.run();
    return { envoyes };
  }
}
