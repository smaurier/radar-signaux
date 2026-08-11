import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { InpiService } from './inpi.service';
import { InpiActesService } from './inpi-actes.service';
import { InpiAuthService } from './inpi-auth.service';
import { InpiController } from './inpi.controller';

@Module({
  imports: [StorageModule],
  controllers: [InpiController],
  providers: [InpiService, InpiActesService, InpiAuthService],
})
export class InpiModule {}
