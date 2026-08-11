import { Controller, Get, Query } from '@nestjs/common';
import { DeclarationService } from './declaration.service';

@Controller('a11y/declaration')
export class DeclarationController {
  constructor(private readonly declaration: DeclarationService) {}

  /** Test manuel sur un domaine unique (dev/debug). */
  @Get()
  async detecter(@Query('domaine') domaine: string) {
    return this.declaration.detecter(domaine);
  }
}
