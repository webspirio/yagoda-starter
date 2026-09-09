import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transfer } from './transfer.entity';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { AuditModule } from '../audit/audit.module';
import { TimeModule } from '../time/time.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { timezoneConfig } from '../config/timezone.config';

/**
 * IMPORTS `ShiftsModule` AS OF THE CASH COUNTS SLICE, reversing this module's
 * original refusal. Cash is now counted per shift, so a transfer accepted
 * outside one belongs to no shift's arithmetic — see the cash counts spec
 * §4.1. `ShiftsService.findOpenAtPoint` takes an `EntityManager`, so the
 * lookup happens inside the same transaction as the write.
 *
 * `TransfersModule` importing `ShiftsModule` is safe because `ShiftsModule`
 * imports neither this module nor anything that reaches back to it — its
 * imports are `AuditModule`, `CollectionPointsModule` and, as of this same
 * slice, `PointCashModule` for the movement arithmetic. That last edge stays
 * acyclic too, because `point-cash` imports nothing but `ConfigModule`.
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
    ShiftsModule,
  ],
  providers: [TransfersService],
  controllers: [TransfersController],
  exports: [TransfersService],
})
export class TransfersModule {}
