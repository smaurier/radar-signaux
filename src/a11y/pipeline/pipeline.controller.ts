import { Controller, Get, Post, Query } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { A11yStorageService } from '../storage/a11y-storage.service';

@Controller('a11y')
export class PipelineController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly storage: A11yStorageService,
  ) {}

  /** Traite un domaine unique de bout en bout (utile pour valider en dev). */
  @Post('traiter')
  async traiter(@Query('domaine') domaine: string) {
    return this.pipeline.traiterDomaine(domaine);
  }

  /** Traite un lot de domaines pas encore vus, depuis le classement CrUX. */
  @Post('traiter-lot')
  async traiterLot(
    @Query('limiteDomaines') limiteDomaines?: string,
    @Query('n') n?: string,
  ) {
    return this.pipeline.traiterLot(
      limiteDomaines ? Number(limiteDomaines) : undefined,
      n ? Number(n) : undefined,
    );
  }

  @Get('prospects')
  prospects(@Query('limit') limit?: string) {
    return this.storage.listerProspectsQualifies(
      limit ? Number(limit) : undefined,
    );
  }

  @Get('recent')
  recent(@Query('limit') limit?: string) {
    return this.storage.listerRecent(limit ? Number(limit) : undefined);
  }
}
