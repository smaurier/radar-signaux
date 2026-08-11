import { Controller, Get, Query } from '@nestjs/common';
import { ScanService } from './scan.service';

@Controller('a11y/scan')
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  /** Test manuel sur un domaine unique (dev/debug). */
  @Get()
  async scanner(@Query('domaine') domaine: string) {
    return this.scan.scanner(domaine);
  }
}
