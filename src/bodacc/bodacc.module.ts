import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { BodaccService } from './bodacc.service';
import { BodaccController } from './bodacc.controller';

@Module({
  imports: [StorageModule],
  controllers: [BodaccController],
  providers: [BodaccService],
})
export class BodaccModule {}
