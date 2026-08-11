import { Controller, Post } from '@nestjs/common';
import { InpiService } from './inpi.service';

@Controller('inpi')
export class InpiController {
  constructor(private readonly inpi: InpiService) {}

  /** Declenche la qualification immediate, utile pour valider en dev. */
  @Post('qualifier')
  async qualifier() {
    const traites = await this.inpi.run();
    return { traites };
  }
}
