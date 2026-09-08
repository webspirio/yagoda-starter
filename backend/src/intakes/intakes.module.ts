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

/**
 * Reads four other modules THROUGH THEIR SERVICES, never their repositories —
 * each stays the sole writer of its own tables and the dependencies point one
 * way. `grade_prices` and `tare_types` are read for §2.8's and §2.5's
 * snapshots; `shifts` for the point and business date, which this module's own
 * tables deliberately do not store.
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
  ],
  providers: [IntakesService],
  controllers: [IntakesController],
  exports: [IntakesService],
})
export class IntakesModule {}
