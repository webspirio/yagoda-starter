import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Intake } from './intake.entity';
import { IntakeItem } from './intake-item.entity';
import { IntakeItemTareType } from './intake-item-tare-type.entity';
import { IntakesService } from './intakes.service';
import { IntakesController } from './intakes.controller';
import { ShiftsModule } from '../shifts/shifts.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { GradePricesModule } from '../grade-prices/grade-prices.module';
import { TareTypesModule } from '../tare-types/tare-types.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { AuditModule } from '../audit/audit.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { CratesModule } from '../crates/crates.module';

/**
 * Reads four other modules THROUGH THEIR SERVICES, never their repositories —
 * each stays the sole writer of its own tables and the dependencies point one
 * way. `grade_prices` and `tare_types` are read for §2.8's and §2.5's
 * snapshots; `shifts` for the point and business date, which this module's own
 * tables deliberately do not store.
 *
 * Imports `PayoutsModule` so the cash handed over with a receipt (§2.1 ⑥) is
 * written by the ONE payout writer, ceilings included. `PayoutsModule` does
 * not import this module back.
 *
 * Imports `CratesModule` for the same reason (spec §8.3): the crates the
 * supplier brings back with a receipt are written by the ONE return writer,
 * `CratesService.writeReturn`, and voided with the receipt by
 * `voidReturnForIntake`. `CratesModule` does not import this module back.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Intake, IntakeItem, IntakeItemTareType]),
    ShiftsModule,
    SuppliersModule,
    GradePricesModule,
    TareTypesModule,
    CollectionPointsModule,
    AuditModule,
    PayoutsModule,
    CratesModule,
  ],
  providers: [IntakesService],
  controllers: [IntakesController],
  exports: [IntakesService],
})
export class IntakesModule {}
