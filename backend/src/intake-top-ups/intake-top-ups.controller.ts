import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IntakeTopUpsService } from './intake-top-ups.service';
import { CreateIntakeTopUpDto } from './dto/create-intake-top-up.dto';
import { ListIntakeTopUpsQueryDto } from './dto/list-intake-top-ups.query';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * «Фантомний залишок» (#61).
 *
 * A FLAT RESOURCE, not `POST /intakes/:id/top-ups` and not
 * `GET /suppliers/:id/top-ups`. Hanging the reads off `/suppliers/:id` would
 * put a second module's route at the same depth as
 * `GET /suppliers/:id/balance`, and `supplier-balance.controller.ts` carries a
 * standing warning about exactly that: cross-module registration order is not
 * ours to control and a collision there produces no startup error.
 * `/intake-top-ups` shares a prefix with nothing.
 *
 * THE ROLE SPLIT IS `transfers`': the owner writes, both roles read. An
 * operator must be able to see the top-up because they are the one handing
 * over the cash — after one, the supplier's «Разом» is 2 000 ₴ higher than
 * anything else on the operator's screen explains, and §3.1 promises the
 * operator one number they can stand behind.
 *
 * CREATE TAKES NO `collection_point_id` and calls no `resolveWritePoint`: the
 * point is implied by the intake, and only an owner can write, and an owner
 * owns every point.
 */
@Controller('intake-top-ups')
export class IntakeTopUpsController {
  constructor(private readonly topUps: IntakeTopUpsService) {}

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateIntakeTopUpDto) {
    return this.topUps.create(actor, dto);
  }

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListIntakeTopUpsQueryDto) {
    return this.topUps.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.topUps.findOne(actor, id);
  }

  @Post(':id/void')
  @Auth(UserRole.NetworkOwner)
  voidOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ) {
    return this.topUps.void(actor, id, dto);
  }
}
