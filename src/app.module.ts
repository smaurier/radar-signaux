import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BodaccModule } from './bodacc/bodacc.module';

@Module({
  imports: [ScheduleModule.forRoot(), BodaccModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
