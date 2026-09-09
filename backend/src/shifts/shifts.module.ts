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
 * REGISTERS `CashCount` HERE, NOT IN A `cash-counts` MODULE OF ITS OWN.
 * `cash_counts` has no service and no controller of its own in this slice —
 * §6.1 writes its rows from inside `open` (and Task 6's `close`), and every
 * read of them goes through `PointCashService`'s formulas. A module that owns
 * only an entity for one writer to reach through `forFeature` would be a
 * module in name only.
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
