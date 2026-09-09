import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { DisputeTransferDto } from './dto/dispute-transfer.dto';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §7.9 — the base→point transfer.
 *
 * ROLE AUTHORITY IS SPLIT BETWEEN THE GUARD AND THE SERVICE, on the codebase's
 * usual line: a guard decides from the request, an `assert*` decides from the
 * row. `create` is owner-only from the request alone; accept and dispute need
 * to know WHICH point's transfer this is, so they carry `@Auth()` here and
 * refuse in the service.
 *
 * No `PATCH`, no `DELETE` — §9.3 and §10.4.
 */
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateTransferDto) {
    return this.transfers.create(actor, dto);
  }

  @Post(':id/accept')
  @Auth()
  accept(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.accept(actor, id);
  }

  @Post(':id/dispute')
  @Auth()
  dispute(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisputeTransferDto,
  ) {
    return this.transfers.dispute(actor, id, dto);
  }
}
