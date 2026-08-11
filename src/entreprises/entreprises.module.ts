import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { EntreprisesService } from './entreprises.service';
import { EntreprisesController } from './entreprises.controller';

@Module({
  imports: [StorageModule],
  controllers: [EntreprisesController],
  providers: [EntreprisesService],
  exports: [EntreprisesService],
})
export class EntreprisesModule {}
