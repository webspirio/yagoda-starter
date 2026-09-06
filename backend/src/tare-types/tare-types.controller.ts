import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { TareTypesService } from './tare-types.service';
import { CreateTareTypeDto } from './dto/create-tare-type.dto';
import { UpdateTareTypeDto } from './dto/update-tare-type.dto';
import { ListTareTypesQueryDto } from './dto/list-tare-types.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * No DELETE, no `GET /:id`.
 *
 * Reads are open to BOTH roles, which means an operator can see
 * `deposit_price`. That is deliberate: it is money they physically collect
 * (§6.3), and their intake screen needs `weight_kg` for §2.5's automatic tare
 * subtraction. Writes are owner-only — the `tare_types` Note says it outright:
 * «Обидва числа РЕДАГУЮТЬСЯ керівником».
 */
@Controller('tare-types')
export class TareTypesController {
  constructor(private readonly tareTypes: TareTypesService) {}

  @Get()
  @Auth()
  list(@Query() query: ListTareTypesQueryDto) {
    return this.tareTypes.list(query);
  }

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateTareTypeDto) {
    return this.tareTypes.create(actor, dto);
  }

  @Patch(':id')
  @Auth(UserRole.NetworkOwner)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTareTypeDto,
  ) {
    return this.tareTypes.update(actor, id, dto);
  }
}
