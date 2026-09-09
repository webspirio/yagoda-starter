import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transfer } from './transfer.entity';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { AuditModule } from '../audit/audit.module';
import { TimeModule } from '../time/time.module';
import { timezoneConfig } from '../config/timezone.config';

/**
 * NO `ShiftsModule` IMPORT, deliberately — spec §6.4. A transfer is
 * point-scoped and its acceptance needs no open shift.
 *
 * `ConfigModule.forFeature(timezoneConfig)` IS REQUIRED, not decorative: the
 * list's date filter compares `sent_at` — a `timestamptz` — against a local
 * business date, so `TransfersService` injects the app timezone by token and
 * Nest cannot resolve that token unless the namespace is registered here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Transfer]),
    ConfigModule.forFeature(timezoneConfig),
    CollectionPointsModule,
    AuditModule,
    TimeModule,
  ],
  providers: [TransfersService],
  controllers: [TransfersController],
  exports: [TransfersService],
})
export class TransfersModule {}
