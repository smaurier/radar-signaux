import { Controller, Post } from '@nestjs/common';
import { EntreprisesService } from './entreprises.service';

@Controller('entreprises')
export class EntreprisesController {
  constructor(private readonly entreprises: EntreprisesService) {}

  /** Declenche l'enrichissement immediat, utile pour valider en dev. */
  @Post('enrichir')
  async enrichir() {
    const enrichis = await this.entreprises.run();
    return { enrichis };
  }
}
