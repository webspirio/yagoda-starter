import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PayoutAllocation } from './payout-allocation.entity';
import { AllocationsService } from './services/allocations';
import { SupplierDebtQuery } from './queries/supplier-debt.query';
import { SupplierBalanceBreakdownQuery } from './queries/supplier-balance-breakdown.query';
import { ListSupplierBalancesQuery } from './queries/list-supplier-balances.query';
import { SupplierSettlementQuery } from './queries/supplier-settlement.query';
import { ListSupplierTotalsQuery } from './queries/list-supplier-totals.query';
import { SupplierTotalsController } from './supplier-totals.controller';
import { SupplierBalanceController } from './supplier-balance.controller';
import { SupplierBalancesController } from './supplier-balances.controller';

/**
 * Owns `payout_allocations` and the debt formula. Reads `intakes`, `intake_top_ups` and
 * `payouts` directly (reads are open); writes only its own table, through
 * `AllocationsService`. Exports the ledger (every debt write) and `SupplierDebtQuery` (the
 * payout ceiling). Also serves `/supplier-totals` (#230), which reuses the debt terms for «нараховано».
 */
@Module({
  imports: [SuppliersModule, TypeOrmModule.forFeature([PayoutAllocation])],
  providers: [
    AllocationsService,
    SupplierDebtQuery,
    SupplierBalanceBreakdownQuery,
    ListSupplierBalancesQuery,
    SupplierSettlementQuery,
    ListSupplierTotalsQuery,
  ],
  controllers: [SupplierBalanceController, SupplierBalancesController, SupplierTotalsController],
  exports: [AllocationsService, SupplierDebtQuery],
})
export class SupplierBalanceModule {}
