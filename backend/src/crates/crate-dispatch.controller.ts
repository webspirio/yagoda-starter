import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CrateDispatchService, CrateDispatchResponse } from './crate-dispatch.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §6.8's dispatch line for the close screen. A FOURTH controller in this
 * module for the reason there are already three: `/shifts/:id/crates` cannot
 * live on a `/crate-issuances` prefix.
 *
 * IT MUST SERVE AN OPEN SHIFT. The close form renders «з ягодою 142» while the
 * operator is still typing the breakage, so refusing an open shift would make
 * this useless to the one screen that needs it.
 *
 * `@Auth()` — both roles. §6.10 gives the operator their own point's crate
 * summary at close; point scope comes from `ShiftsService.findOne`.
 */
@Controller('shifts')
export class CrateDispatchController {
  constructor(private readonly dispatch: CrateDispatchService) {}

  @Get(':id/crates')
  @Auth()
  forShift(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CrateDispatchResponse> {
    return this.dispatch.forShift(actor, id);
  }
}
