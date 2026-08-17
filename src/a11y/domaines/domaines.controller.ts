import { Controller, Get, Query } from '@nestjs/common';
import { DomainesService } from './domaines.service';

@Controller('a11y/domaines')
export class DomainesController {
  constructor(private readonly domaines: DomainesService) {}

  /** Liste les domaines cibles (dev/debug), sans rien stocker. */
  @Get()
  async lister(@Query('limite') limite?: string) {
    const domaines = await this.domaines.listerDomaines(
      limite ? Number(limite) : undefined,
    );
    return { total: domaines.length, domaines };
  }
}
