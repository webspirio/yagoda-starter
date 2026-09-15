import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CratesService } from './crates.service';
import { CreateCrateReturnDto } from './dto/create-crate-return.dto';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { CrateReturnResponse } from './crate-return.mapper';
import { CrateAllocationResult } from './crate-allocation';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Crates coming back. BOTH ROLES — accepting a return is a point action, same
 * as issuing (`CrateIssuancesController`).
 */
@Controller('crate-returns')
export class CrateReturnsController {
  constructor(private readonly crates: CratesService) {}

  @Post()
  @Auth()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateCrateReturnDto,
  ): Promise<CrateReturnResponse> {
    return this.crates.returnCrates(actor, dto);
  }

  /** Create minus the write — the reception screen's live split before commit. */
  @Post('preview')
  @Auth()
  preview(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateCrateReturnDto,
  ): Promise<CrateAllocationResult> {
    return this.crates.previewReturn(actor, dto);
  }

  /** Authority is decided from the row by `CratesService.assertMayVoid`, never
   *  by a guard — see that method's doc comment. */
  @Post(':id/void')
  @Auth()
  voidReturn(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidDocumentDto,
  ): Promise<CrateReturnResponse> {
    return this.crates.voidReturn(actor, id, dto);
  }
}
