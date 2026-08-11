import { Controller, Post } from '@nestjs/common';
import { InpiService } from './inpi.service';
import { InpiActesService } from './inpi-actes.service';

@Controller('inpi')
export class InpiController {
  constructor(
    private readonly inpi: InpiService,
    private readonly inpiActes: InpiActesService,
  ) {}

  /** Declenche la qualification immediate (capital actuel), utile pour valider en dev. */
  @Post('qualifier')
  async qualifier() {
    const traites = await this.inpi.run();
    return { traites };
  }

  /** Declenche la lecture d'actes immediate (sens + montant), utile pour valider en dev. */
  @Post('lire-actes')
  async lireActes() {
    const traites = await this.inpiActes.run();
    return { traites };
  }
}
