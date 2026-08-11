import { Controller, Post } from '@nestjs/common';
import { PresseService } from './presse.service';

@Controller('presse')
export class PresseController {
  constructor(private readonly presse: PresseService) {}

  /** Declenche une passe de confirmation presse immediate, utile pour valider en dev. */
  @Post('run')
  async run() {
    const matches = await this.presse.run();
    return { confirmes: matches.length, matches };
  }
}
