import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListSupplierTotalsQuery } from './queries/list-supplier-totals.query';
import { ListSupplierTotalsQueryDto } from './dto/list-supplier-totals.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** The suppliers page (#230): each supplier with weight, accrued and main product. Both roles;
 *  scope is `resolvePointFilter`'s, inside the query. Own prefix, so no route-order caveat. */
@Controller('supplier-totals')
export class SupplierTotalsController {
  constructor(private readonly totals: ListSupplierTotalsQuery) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListSupplierTotalsQueryDto) {
    return this.totals.list(actor, query);
  }
}
