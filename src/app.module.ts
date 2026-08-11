import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BodaccModule } from './bodacc/bodacc.module';
import { PresseModule } from './presse/presse.module';

@Module({
  imports: [ScheduleModule.forRoot(), BodaccModule, PresseModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
