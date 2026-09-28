import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListSupplierBalancesQuery } from './queries/list-supplier-balances.query';
import { ListSupplierBalancesQueryDto } from './dto/list-supplier-balances.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * The «Залишки» screen: every supplier's outstanding balance at a point, on one page.
 * A SECOND CONTROLLER because `/supplier-balances` shares a prefix with nothing —
 * unlike `/suppliers/:id/balance`, no registration-order caveat applies here.
 * Scope is decided by `resolvePointFilter` inside the query, not here.
 */
@Controller('supplier-balances')
export class SupplierBalancesController {
  constructor(private readonly balances: ListSupplierBalancesQuery) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListSupplierBalancesQueryDto) {
    return this.balances.list(actor, query);
  }
}
