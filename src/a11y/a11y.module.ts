import { Module } from '@nestjs/common';
import { DomainesService } from './domaines/domaines.service';
import { DomainesController } from './domaines/domaines.controller';
import { MentionsLegalesService } from './entreprises/mentions-legales.service';
import { MentionsLegalesController } from './entreprises/mentions-legales.controller';
import { QualificationService } from './entreprises/qualification.service';
import { QualificationController } from './entreprises/qualification.controller';
import { NavigateurService } from './navigateur.service';

@Module({
  controllers: [DomainesController, MentionsLegalesController, QualificationController],
  providers: [DomainesService, MentionsLegalesService, QualificationService, NavigateurService],
})
export class A11yModule {}
