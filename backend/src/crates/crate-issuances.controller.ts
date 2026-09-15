import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CratesService } from './crates.service';
import { CrateBalanceService } from './crate-balance.service';
import { CreateCrateIssuanceDto } from './dto/create-crate-issuance.dto';
import { ListCrateIssuancesQueryDto } from './dto/list-crate-issuances.query';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { CrateIssuanceResponse } from './crate-issuance.mapper';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Crates going out. BOTH ROLES — handing crates over is a point action, and
 * §6.10 makes the balance the operator's own working number.
 */
@Controller('crate-issuances')
export class CrateIssuancesController {
  constructor(
    private readonly crates: CratesService,
    private readonly balance: CrateBalanceService,
  ) {}

  /**
   * The journal, ticket #58's «показати усі розписки постачальника» and the
   * owner's voided-deposit incident list, all through one query shape — see
   * `CrateBalanceService.listIssuances`.
   */
  @Get()
  @Auth()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListCrateIssuancesQueryDto,
  ): Promise<Paginated<CrateIssuanceResponse>> {
    return this.balance.listIssuances(actor, query);
  }

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
