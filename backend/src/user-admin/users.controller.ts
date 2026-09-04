import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { UserAdminService } from './user-admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { ListUsersQueryDto } from './dto/list-users.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Every route here is owner-only, so the role sits on the CLASS rather than
 * being repeated per handler — one place to read, and a new handler cannot
 * forget it. Note that a bare `@Auth()` on a method would INHERIT this role,
 * not clear it (see the decorator's own doc comment): there is no way to spell
 * "authenticated but role-free" on a handler of this controller, and no reason
 * to want one.
 *
 * There is no DELETE: users are deactivated, never removed (§5.6), and every
 * document carries their id under ON DELETE RESTRICT anyway.
 */
@Controller('users')
@Auth(UserRole.NetworkOwner)
export class UsersController {
  constructor(private readonly admin: UserAdminService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListUsersQueryDto) {
    return this.admin.list(actor, query);
  }

  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.admin.create(actor, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.admin.update(actor, id, dto);
  }

  @Put(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  setPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPasswordDto,
  ): Promise<void> {
    return this.admin.setPassword(actor, id, dto);
  }
}
