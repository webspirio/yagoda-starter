import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { CollectionPointsService } from './collection-points.service';
import { CreateCollectionPointDto } from './dto/create-collection-point.dto';
import { UpdateCollectionPointDto } from './dto/update-collection-point.dto';
import { ListCollectionPointsQueryDto } from './dto/list-collection-points.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * There is no DELETE here and there never will be — §5.6, deactivation is the
 * only removal verb the domain has.
 *
 * The literal route is declared before the parameterised one: HTTP resolves
 * handlers in registration order.
 */
@Controller('collection-points')
export class CollectionPointsController {
  constructor(private readonly points: CollectionPointsService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListCollectionPointsQueryDto) {
    return this.points.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.points.findOne(actor, id);
  }

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateCollectionPointDto) {
    return this.points.create(actor, dto);
  }

  /** §10.2 — only the owner changes a target. On the operator's screen the
   *  control does not EXIST rather than appearing disabled: «заблокована кнопка
   *  вчить шукати обхід, відсутня не вчить нічого». That is the UI's half of
   *  this rule; this decorator is the API's. */
  @Patch(':id')
  @Auth(UserRole.NetworkOwner)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollectionPointDto,
  ) {
    return this.points.update(actor, id, dto);
  }
}
