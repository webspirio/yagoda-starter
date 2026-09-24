import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashCount } from './cash-count.entity';
import { CashCountsService } from './cash-counts.service';
import { CashCountsController } from './cash-counts.controller';
import { ShiftsModule } from '../shifts/shifts.module';
import { PointCashModule } from '../point-cash/point-cash.module';
import { AuditModule } from '../audit/audit.module';

/**
 * `CashCount` IS STILL REGISTERED HERE for TypeORM's benefit (the entity needs
 * a home for migrations and `autoLoadEntities`) even though every query in
 * this module is either raw SQL through `DataSource` (`list`) or an
 * `EntityManager.save` inside a transaction (`recount`) — never a repository.
 * `shifts` remains the sole writer of `opening`/`closing` rows; this module now
 * writes the third kind, `midday`, and only that one (`CashCountsService`'s
 * header explains why `midday` is the one kind that was always meant to live
 * outside a shift verb).
 *
 * IMPORTS `ShiftsModule` (for `ShiftsService.findOpenAtPoint`), `PointCashModule`
 * (for `PointCashService.cashFor`) AND `AuditModule`. This closes no cycle:
 * `ShiftsModule` imports `TypeOrmModule.forFeature([Shift, CashCount])`,
 * `AuditModule`, `CollectionPointsModule` and `PointCashModule` — it does NOT
 * import `CashCountsModule` (checked before wiring this; its own header only
 * MENTIONS `CashCountsModule` in a comment about the read side, never imports
 * it), so this edge is one-way.
 *
 * EXPORTS NOTHING — nothing outside this module has a reason to read a count
 * or write a recount except through this module's own controller.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CashCount]), ShiftsModule, PointCashModule, AuditModule],
  providers: [CashCountsService],
  controllers: [CashCountsController],
})
export class CashCountsModule {}
