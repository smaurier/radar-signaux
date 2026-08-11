import { Module } from '@nestjs/common';
import { DomainesService } from './domaines/domaines.service';
import { DomainesController } from './domaines/domaines.controller';
import { MentionsLegalesService } from './entreprises/mentions-legales.service';
import { MentionsLegalesController } from './entreprises/mentions-legales.controller';
import { QualificationService } from './entreprises/qualification.service';
import { QualificationController } from './entreprises/qualification.controller';
import { DeclarationService } from './declaration/declaration.service';
import { DeclarationController } from './declaration/declaration.controller';
import { ScanService } from './scan/scan.service';
import { ScanController } from './scan/scan.controller';
import { PipelineService } from './pipeline/pipeline.service';
import { PipelineController } from './pipeline/pipeline.controller';
import { A11yStorageService } from './storage/a11y-storage.service';
import { NavigateurService } from './navigateur.service';
import { PageFetcherService } from './page-fetcher.service';

@Module({
  controllers: [
    DomainesController,
    MentionsLegalesController,
    QualificationController,
    DeclarationController,
    ScanController,
    PipelineController,
  ],
  providers: [
    DomainesService,
    MentionsLegalesService,
    QualificationService,
    DeclarationService,
    ScanService,
    PipelineService,
    A11yStorageService,
    NavigateurService,
    PageFetcherService,
  ],
})
export class A11yModule {}
