import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { ReweighsService } from './reweighs.service';
import { CreateReweighItemDto } from './dto/create-reweigh-item.dto';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { ReweighItemResponse } from './reweigh-item.mapper';
import { ReweighReconciliationService, ReconciliationResponse } from './reweigh-reconciliation.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §8 IS THE OWNER'S WORLD, READS INCLUDED (spec §3.10): §8.7 «переважує і
 * сторнує тільки керівник». Whether the operator ever sees the недостача
 * claimed against his own point is an open question, not an oversight.
 */
@Controller()
@Auth(UserRole.NetworkOwner)
export class ReweighsController {
  constructor(
    private readonly reweighs: ReweighsService,
    private readonly reconciliation_: ReweighReconciliationService,
  ) {}

  @Get('shifts/:shiftId/reweigh')
  reconciliation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
  ): Promise<ReconciliationResponse> {
    return this.reconciliation_.forShift(actor, shiftId);
  }

  @Post('shifts/:shiftId/reweigh-items')
  addItem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @Body() dto: CreateReweighItemDto,
  ): Promise<ReweighItemResponse> {
    return this.reweighs.addItem(actor, shiftId, dto);
  }

  @Post('reweigh-items/:id/void')
  voidItem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ): Promise<ReweighItemResponse> {
    return this.reweighs.voidItem(actor, id, dto);
  }
}
