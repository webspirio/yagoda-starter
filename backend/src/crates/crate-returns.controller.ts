import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CratesService } from './crates.service';
import { CrateBalanceService } from './crate-balance.service';
import { CreateCrateReturnDto } from './dto/create-crate-return.dto';
import { ListCrateReturnsQueryDto } from './dto/list-crate-returns.query';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { CrateReturnResponse, CrateReturnPreviewResponse } from './crate-return.mapper';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Crates coming back. BOTH ROLES — accepting a return is a point action, same
 * as issuing (`CrateIssuancesController`).
 */
@Controller('crate-returns')
export class CrateReturnsController {
  constructor(
    private readonly crates: CratesService,
    private readonly balance: CrateBalanceService,
  ) {}

  /** The journal — see `CrateBalanceService.listReturns`. */
  @Get()
  @Auth()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListCrateReturnsQueryDto,
  ): Promise<Paginated<CrateReturnResponse>> {
    return this.balance.listReturns(actor, query);
  }

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
  @HttpCode(HttpStatus.OK)
  @Auth()
  preview(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateCrateReturnDto,
  ): Promise<CrateReturnPreviewResponse> {
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
