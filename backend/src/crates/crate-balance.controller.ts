import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CrateBalanceService, CrateBalanceResponse } from './crate-balance.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** §6.3's header and the reception screen's «на руках». `SuppliersService.findOne`
 *  is what enforces point scope — a supplier at another point 404s there. */
@Controller('suppliers')
export class CrateBalanceController {
  constructor(
    private readonly balance: CrateBalanceService,
    private readonly suppliers: SuppliersService,
  ) {}

  @Get(':id/crate-balance')
  @Auth()
  async bySupplier(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CrateBalanceResponse> {
    await this.suppliers.findOne(actor, id);
    return this.balance.balanceFor(id);
  }
}
