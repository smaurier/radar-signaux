import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { PresseService } from './presse.service';
import { PresseController } from './presse.controller';

@Module({
  imports: [StorageModule],
  controllers: [PresseController],
  providers: [PresseService],
})
export class PresseModule {}
