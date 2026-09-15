import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { GradePricesService } from './grade-prices.service';
import { CreateGradePriceDto } from './dto/create-grade-price.dto';
import { BulkGradePriceDto } from './dto/bulk-grade-price.dto';
import { ListGradePricesQueryDto } from './dto/list-grade-prices.query';
import { CurrentGradePricesQueryDto } from './dto/current-grade-prices.query';
import { GradePriceSheetQueryDto } from './dto/grade-price-sheet.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * TWO READ ROUTES, NOT ONE FLAGGED ROUTE. They serve different readers at
 * different volumes and, decisively, with different pagination profiles:
 * `/current` is a bounded picker (`CatalogPaginationQueryDto`, default 100),
 * `/grade-prices` is an unbounded browsable journal (`PaginationQueryDto`,
 * default 20). A single handler switching its own pagination default on a
 * boolean is the thing that gets misread later.
 *
 * NO `PATCH`, NO `DELETE`, NO `GET /:id`. A correction is a new row (§4.2),
 * and no client holds a bare price id.
 *
 * Reads are open to BOTH roles: the operator's intake screen needs
 * `base_price` to price a line and `max_markup`/`max_discount` to bound the
 * `bonus` they type. Writes are owner-only — everything configurable belongs
 * to the керівник (§10.1).
 *
 * `POST` takes `collection_point_id` FROM THE BODY, which is a documented
 * exception to `point-scope.ts`'s «never accepted from a request body». The
 * route is owner-only and an owner has no point, so there is nothing to derive
 * it from; `assertOwnsPoint` in the service validates it. This is the first
 * caller to take that branch — see `CreateGradePriceDto`'s doc comment.
 */
@Controller('grade-prices')
export class GradePricesController {
  constructor(private readonly prices: GradePricesService) {}

  /** Declared BEFORE the bare `@Get()`: Nest matches routes in declaration
   *  order, and a `@Get(':id')` added here later would otherwise swallow
   *  `/current`. There is no `:id` route today; the ordering is kept so adding
   *  one cannot break this silently. */
  @Get('current')
  @Auth()
  current(@CurrentUser() actor: AuthenticatedUser, @Query() query: CurrentGradePricesQueryDto) {
    return this.prices.current(actor, query);
  }

  /** Declared alongside `/current` and BEFORE the bare `@Get()`, for the
   *  declaration-order reason given above it. */
  @Get('sheet')
  @Auth()
  sheet(@CurrentUser() actor: AuthenticatedUser, @Query() query: GradePriceSheetQueryDto) {
    return this.prices.sheet(actor, query);
  }

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListGradePricesQueryDto) {
    return this.prices.list(actor, query);
  }

  /** Declared BEFORE the bare `@Post()` for the same declaration-order reason
   *  `/current` is declared before the bare `@Get()`. */
  @Post('bulk')
  @Auth(UserRole.NetworkOwner)
  bulk(@CurrentUser() actor: AuthenticatedUser, @Body() dto: BulkGradePriceDto) {
    return this.prices.bulk(actor, dto);
  }

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateGradePriceDto) {
    return this.prices.create(actor, dto);
  }
}
