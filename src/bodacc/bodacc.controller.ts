import { Controller, Get, Post, Query } from '@nestjs/common';
import { BodaccService } from './bodacc.service';
import { StorageService } from '../storage/storage.service';

@Controller('bodacc')
export class BodaccController {
  constructor(
    private readonly bodacc: BodaccService,
    private readonly storage: StorageService,
  ) {}

  /** Declenche une collecte immediate (hors cron), utile pour valider en dev. */
  @Post('run')
  async run() {
    const nouveaux = await this.bodacc.run();
    return { nouveaux: nouveaux.length, signaux: nouveaux };
  }

  @Get('signaux')
  list(@Query('limit') limit?: string) {
    return this.storage.listRecent(limit ? Number(limit) : undefined);
  }
}
