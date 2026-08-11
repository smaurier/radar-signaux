import { Module } from '@nestjs/common';
import { DomainesService } from './domaines/domaines.service';
import { DomainesController } from './domaines/domaines.controller';
import { MentionsLegalesService } from './entreprises/mentions-legales.service';
import { MentionsLegalesController } from './entreprises/mentions-legales.controller';
import { QualificationService } from './entreprises/qualification.service';
import { QualificationController } from './entreprises/qualification.controller';
import { DeclarationService } from './declaration/declaration.service';
import { DeclarationController } from './declaration/declaration.controller';
import { NavigateurService } from './navigateur.service';
import { PageFetcherService } from './page-fetcher.service';

@Module({
  controllers: [
    DomainesController,
    MentionsLegalesController,
    QualificationController,
    DeclarationController,
  ],
  providers: [
    DomainesService,
    MentionsLegalesService,
    QualificationService,
    DeclarationService,
    NavigateurService,
    PageFetcherService,
  ],
})
export class A11yModule {}
