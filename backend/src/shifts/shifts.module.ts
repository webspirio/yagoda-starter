import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shift } from './shift.entity';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { AuditModule } from '../audit/audit.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { CashCount } from '../cash-counts/cash-count.entity';
import { PointCashModule } from '../point-cash/point-cash.module';

/**
 * Exports `ShiftsService` because both document modules resolve their shift
 * through it rather than reaching for the repository — `shifts` stays the sole
 * writer of its own table, and `findOpenAtPoint` accepts an `EntityManager` so
 * a document write reads it inside its own transaction.
 *
 * REGISTERS `CashCount` HERE AS WELL AS IN `CashCountsModule`, and the
 * duplication is deliberate rather than an oversight. `CashCountsModule` owns
 * the READ side — `CashCountsService` and its controller serve the owner's
 * incident list. `shifts` owns the only WRITE path: §6.1 writes the opening
 * count from inside `open`, `close` writes the closing one, and `reopen`
 * demotes it to `midday` — all three inside the shift's own transaction, which
 * is why this module needs the repository registered rather than a service to
 * call. `forFeature` is per-module metadata, so registering the same entity in
 * both is how TypeORM expresses «two modules, one table».
 *
 * IMPORTS `PointCashModule` FOR `expectedForOpening`, and it closes no cycle:
 * `point-cash` imports nothing but `ConfigModule`, so this edge is one-way.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Shift, CashCount]),
    AuditModule,
    CollectionPointsModule,
    PointCashModule,
  ],
  providers: [ShiftsService],
  controllers: [ShiftsController],
  exports: [ShiftsService],
})
export class ShiftsModule {}
