import { Controller, Get, Query } from '@nestjs/common';
import { MentionsLegalesService } from './mentions-legales.service';

@Controller('a11y/siren')
export class MentionsLegalesController {
  constructor(private readonly mentionsLegales: MentionsLegalesService) {}

  /** Test manuel sur un domaine unique (dev/debug). */
  @Get()
  async extraire(@Query('domaine') domaine: string) {
    return this.mentionsLegales.extraireSiren(domaine);
  }
}
