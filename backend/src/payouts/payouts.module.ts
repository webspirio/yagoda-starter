import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payout } from './payout.entity';
import { PayoutsService } from './payouts.service';
import { PayoutsController } from './payouts.controller';
import { ShiftsModule } from '../shifts/shifts.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SupplierBalanceModule } from '../supplier-balance/supplier-balance.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { AuditModule } from '../audit/audit.module';
import { PointCashModule } from '../point-cash/point-cash.module';

/**
 * Imports `SupplierBalanceModule` for the §3.6 ceiling — the debt formula lives
 * in exactly one place and this module calls it rather than re-deriving the
 * `voided_at IS NULL` filters that make it correct.
 *
 * It does NOT import `IntakesModule`, even though a payout is checked against a
 * sum over `intakes`: that sum belongs to `supplier-balance`, and reaching for
 * the intakes service here would put half the formula in a second home.
 *
 * Imports `PointCashModule` for the cash half of §3.6 (2026-09-21): the drawer
 * formula lives in exactly one place too.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Payout]),
    ShiftsModule,
    SuppliersModule,
    SupplierBalanceModule,
    CollectionPointsModule,
    AuditModule,
    PointCashModule,
  ],
  providers: [PayoutsService],
  controllers: [PayoutsController],
  exports: [PayoutsService],
})
export class PayoutsModule {}
