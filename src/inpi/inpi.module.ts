import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { InpiService } from './inpi.service';
import { InpiController } from './inpi.controller';

@Module({
  imports: [StorageModule],
  controllers: [InpiController],
  providers: [InpiService],
})
export class InpiModule {}
