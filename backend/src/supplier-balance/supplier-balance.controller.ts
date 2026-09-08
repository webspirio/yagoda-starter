import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupplierBalanceService } from './supplier-balance.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { toSupplierBalanceResponse } from './supplier-balance.mapper';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §3.1's «Разом» — the one number the operator sees before deciding what to pay:
 * «приймальник не бачить двох сум і не складає їх у голові».
 *
 * REGISTERED BY THIS MODULE, NOT BY `suppliers`, and that is safe only because
 * the path has ONE MORE SEGMENT than `GET /suppliers/:id`. Nest resolves
 * handlers in registration order and the order across modules is not ours to
 * control, so a later slice adding `GET /suppliers/:something` at the SAME
 * depth would have to live in `SuppliersModule` instead — it could otherwise
 * shadow, or be shadowed by, that route with no startup error.
 *
 * Visibility is delegated to `SuppliersService.findOne`, which 404s (not 403s)
 * another point's supplier. Without that call an operator could read the
 * balance of a person at a point they cannot see.
 */
@Controller('suppliers')
export class SupplierBalanceController {
  constructor(
    private readonly balance: SupplierBalanceService,
    private readonly suppliers: SuppliersService,
  ) {}

  @Get(':id/balance')
  @Auth()
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const supplier = await this.suppliers.findOne(actor, id);
    return toSupplierBalanceResponse(supplier.id, await this.balance.debtFor(supplier.id));
  }
}
