import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * THE ONLY DOMAIN MODULE WHOSE WRITES ARE OPEN TO BOTH ROLES (self-service
 * `/me` aside), and the break is deliberate. A car arrives at a roadside point
 * with 40 kg of raspberries and a person the operator has never seen; under
 * owner-only writes the delivery cannot be taken until someone elsewhere
 * creates the record. §3.9 nails the supplier to the point precisely because
 * this is a point-level, in-the-moment act.
 *
 * `kind` does not justify a stricter rule on part of the row: §2.11 is
 * explicit that «базова ціна від маркера не залежить ніколи», so `wholesale`
 * is a reporting marker with no effect on money.
 *
 * Every handler is `@Auth()` — both roles — and the point-level rule is
 * enforced in the SERVICE by `assertOwnsPoint`/`resolvePointFilter`, per this
 * codebase's convention that guards decide from the request alone and
 * `assert*` decides from a row.
 *
 * No DELETE — §5.6, «видалення немає, тільки is_active».
 */
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListSuppliersQueryDto) {
    return this.suppliers.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.findOne(actor, id);
  }

  @Post()
  @Auth()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(actor, dto);
  }

  @Patch(':id')
  @Auth()
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(actor, id, dto);
  }
}
