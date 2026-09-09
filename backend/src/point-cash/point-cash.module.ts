import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PointCashService } from './point-cash.service';
import { PointCashController } from './point-cash.controller';
import { timezoneConfig } from '../config/timezone.config';

/**
 * OWNS NO TABLE. It reads `transfers`, `payouts` and `shifts` in raw SQL and
 * writes nothing, so it registers no entity — the shape `supplier-balance`
 * established.
 *
 * `PointCashService` is EXPORTED because slice 2 (`cash_counts`) calls
 * `cashFor` for every `expected_amount` it snapshots. That is the seam; do not
 * let the formula grow a second home there.
 */
@Module({
  imports: [ConfigModule.forFeature(timezoneConfig)],
  providers: [PointCashService],
  controllers: [PointCashController],
  exports: [PointCashService],
})
export class PointCashModule {}
