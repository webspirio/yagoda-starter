import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { DisputeTransferDto } from './dto/dispute-transfer.dto';
import { ResolveTransferDto } from './dto/resolve-transfer.dto';
import { ListTransfersQueryDto } from './dto/list-transfers.query';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
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

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListTransfersQueryDto) {
    return this.transfers.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.findOne(actor, id);
  }

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

  @Post(':id/resolve')
  @Auth(UserRole.NetworkOwner)
  resolve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveTransferDto,
  ) {
    return this.transfers.resolve(actor, id, dto);
  }

  @Post(':id/void')
  @Auth(UserRole.NetworkOwner)
  void(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ) {
    return this.transfers.void(actor, id, dto);
  }
}
