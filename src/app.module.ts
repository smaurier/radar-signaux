import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BodaccModule } from './bodacc/bodacc.module';
import { PresseModule } from './presse/presse.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EntreprisesModule } from './entreprises/entreprises.module';
import { InpiModule } from './inpi/inpi.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BodaccModule,
    EntreprisesModule,
    InpiModule,
    PresseModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
