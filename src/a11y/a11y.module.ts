import { Module } from '@nestjs/common';
import { DomainesService } from './domaines/domaines.service';
import { DomainesController } from './domaines/domaines.controller';
import { MentionsLegalesService } from './entreprises/mentions-legales.service';
import { MentionsLegalesController } from './entreprises/mentions-legales.controller';
import { NavigateurService } from './navigateur.service';

@Module({
  controllers: [DomainesController, MentionsLegalesController],
  providers: [DomainesService, MentionsLegalesService, NavigateurService],
})
export class A11yModule {}
