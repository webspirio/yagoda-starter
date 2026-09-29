import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupplierDebtQuery } from './queries/supplier-debt.query';
import { SupplierSettlementQuery } from './queries/supplier-settlement.query';
import { SuppliersService } from '../suppliers/suppliers.service';
import { toSupplierBalanceResponse, toSupplierSettlementResponse } from './supplier-balance.mapper';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §3.1's «Разом» — the one number the operator sees before deciding what to pay.
 *
 * REGISTERED BY THIS MODULE, NOT BY `suppliers`: the path has ONE MORE SEGMENT
 * than `GET /suppliers/:id`. Nest resolves handlers in registration order, so a
 * later route at the SAME depth would have to live in `SuppliersModule` instead.
 *
 * Visibility is `SuppliersService.findOne`'s — another point's supplier is a 404.
 */
@Controller('suppliers')
export class SupplierBalanceController {
  constructor(
    private readonly debt: SupplierDebtQuery,
    private readonly settlementQuery: SupplierSettlementQuery,
    private readonly suppliers: SuppliersService,
  ) {}

  @Get(':id/balance')
  @Auth()
  async findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const supplier = await this.suppliers.findOne(actor, id);
    return toSupplierBalanceResponse(supplier.id, await this.debt.debtFor(supplier.id));
  }

  /**
   * «За що саме винні» — spec §4.3. SAME DEPTH AS `/balance`, so the class
   * comment's shadowing warning is honoured. Same visibility call: an
   * operator reading another point's supplier gets the same 404 `findOne`
   * gives everywhere. `/balance` stays a single number on purpose — the
   * payout ceiling reads it and must not pay for a breakdown.
   */
  @Get(':id/settlement')
  @Auth()
  async settlement(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const supplier = await this.suppliers.findOne(actor, id);
    return toSupplierSettlementResponse(
      supplier.id,
      await this.settlementQuery.settlementFor(supplier.id),
    );
  }
}
