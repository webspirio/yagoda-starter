import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CratesService } from './crates.service';
import { CreateCrateIssuanceDto } from './dto/create-crate-issuance.dto';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { CrateIssuanceResponse } from './crate-issuance.mapper';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Crates going out. BOTH ROLES — handing crates over is a point action, and
 * §6.10 makes the balance the operator's own working number.
 */
@Controller('crate-issuances')
export class CrateIssuancesController {
  constructor(private readonly crates: CratesService) {}

  @Post()
  @Auth()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateCrateIssuanceDto,
  ): Promise<CrateIssuanceResponse> {
    return this.crates.issue(actor, dto);
  }

  /** Authority is decided from the row by `CratesService.assertMayVoid`, never
   *  by a guard — see that method's doc comment. */
  @Post(':id/void')
  @Auth()
  voidIssuance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ): Promise<CrateIssuanceResponse> {
    return this.crates.voidIssuance(actor, id, dto);
  }
}
