import { Controller, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Declenche l'envoi immediat du digest, utile pour valider en dev. */
  @Post('run')
  async run() {
    const envoyes = await this.notifications.run();
    return { envoyes };
  }
}
