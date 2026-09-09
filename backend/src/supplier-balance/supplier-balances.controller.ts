import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupplierBalanceService } from './supplier-balance.service';
import { ListSupplierBalancesQueryDto } from './dto/list-supplier-balances.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * The «Залишки» screen — every supplier's outstanding balance at a point, on
 * one page, where `GET /suppliers/:id/balance` answers for one person at a
 * time.
 *
 * A SECOND CONTROLLER IN THIS MODULE, NOT A SECOND ROUTE ON THE FIRST: the
 * single-supplier read hangs off `/suppliers/:id`, and a list belongs under
 * its own noun. `/supplier-balances` shares a prefix with nothing, so the
 * registration-order caveat that governs `/suppliers/:id/balance` does not
 * apply here.
 *
 * Both roles read it. The point scope is decided in the SERVICE by
 * `resolvePointFilter` — an operator is pinned to their own point, an owner
 * chooses — per the convention that guards decide from the request alone and
 * `resolve*` decides from the data.
 */
@Controller('supplier-balances')
export class SupplierBalancesController {
  constructor(private readonly balance: SupplierBalanceService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListSupplierBalancesQueryDto) {
    return this.balance.list(actor, query);
  }
}
