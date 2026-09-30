import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PayoutAllocation } from './payout-allocation.entity';
import { AllocationsService } from './services/allocations';
import { SupplierDebtQuery } from './queries/supplier-debt.query';
import { ListSupplierBalancesQuery } from './queries/list-supplier-balances.query';
import { SupplierSettlementQuery } from './queries/supplier-settlement.query';
import { SupplierBalanceController } from './supplier-balance.controller';
import { SupplierBalancesController } from './supplier-balances.controller';

/**
 * Owns `payout_allocations` and the debt formula. Reads `intakes`, `intake_top_ups` and
 * `payouts` directly (reads are open); writes only its own table, through
 * `AllocationsService`. Exports the ledger (every debt write) and `SupplierDebtQuery` (the
 * payout ceiling).
 */
@Module({
  imports: [SuppliersModule, TypeOrmModule.forFeature([PayoutAllocation])],
  providers: [
    AllocationsService,
    SupplierDebtQuery,
    ListSupplierBalancesQuery,
    SupplierSettlementQuery,
  ],
  controllers: [SupplierBalanceController, SupplierBalancesController],
  exports: [AllocationsService, SupplierDebtQuery],
})
export class SupplierBalanceModule {}
