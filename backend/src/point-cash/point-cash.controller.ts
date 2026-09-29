import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PointCashService } from './point-cash.service';
import { ListPointCashQueryDto } from './dto/list-point-cash.query';
import { assertOwnsPoint } from '../auth/access/point-scope';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §7.1 and §7.10 — the point's drawer, and the network's debt to it.
 *
 * ONE ENDPOINT THAT WIDENS BY ROLE rather than two: «керівник відкриває той
 * самий екран каси, який бачить приймальник цієї точки, плюс свої блоки: одна
 * правда для обох, різна повнота».
 *
 * READ-ONLY, and there is no write here at all. §7.1 — «приймальник не змінює
 * жодної суми каси в програмі»; the only things that move it are documents in
 * other modules (§7.3's closed list).
 */
@Controller('point-cash')
export class PointCashController {
  constructor(private readonly cash: PointCashService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListPointCashQueryDto) {
    return this.cash.list(actor, query);
  }

  @Get(':pointId')
  @Auth()
  async findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('pointId', ParseUUIDPipe) pointId: string,
    @Query() query: ListPointCashQueryDto,
  ) {
    assertOwnsPoint(actor, pointId);
    // Three independent reads — no query depends on another's result — so
    // they run concurrently rather than one round trip after another.
    const [cash, crateDeposits, crateDepositUnits] = await Promise.all([
      this.cash.cashFor(pointId, query.as_of),
      // Never bounded by `as_of` — see `crateDepositsFor`'s doc comment.
      this.cash.crateDepositsFor(pointId),
      // Same exemption, same shape, in units rather than money (R8).
      this.cash.crateUnitsFor(pointId),
    ]);
    return {
      collection_point_id: pointId,
      cash,
      crate_deposits: crateDeposits,
      crate_deposit_units: crateDepositUnits,
    };
  }
}
