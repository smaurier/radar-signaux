import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { LeveesPresseService } from './levees-presse.service';

@Module({
  imports: [StorageModule],
  providers: [LeveesPresseService],
})
export class LeveesModule {}
