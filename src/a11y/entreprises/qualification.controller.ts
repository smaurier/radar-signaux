import { Controller, Get, Query } from '@nestjs/common';
import { QualificationService } from './qualification.service';

@Controller('a11y/qualification')
export class QualificationController {
  constructor(private readonly qualification: QualificationService) {}

  /** Test manuel sur un SIREN unique (dev/debug). */
  @Get()
  async qualifier(@Query('siren') siren: string, @Query('domaine') domaine?: string) {
    return this.qualification.qualifier(siren, domaine);
  }
}
