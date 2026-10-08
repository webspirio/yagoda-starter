import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { GetNetworkSettingsQuery } from './queries/get-network-settings.query';
import { UpdateNetworkSettingsCommand } from './commands/update-network-settings.command';
import { UpdateNetworkSettingsDto } from './dto/update-network-settings.dto';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** Read by everyone — the operator prints the receipts; written by the owner only. */
@Controller('network-settings')
export class NetworkSettingsController {
  constructor(
    private readonly getSettings: GetNetworkSettingsQuery,
    private readonly updateSettings: UpdateNetworkSettingsCommand,
  ) {}

  @Get()
  @Auth()
  get() {
    return this.getSettings.get();
  }

  @Patch()
  @Auth(UserRole.NetworkOwner)
  update(@CurrentUser() actor: AuthenticatedUser, @Body() dto: UpdateNetworkSettingsDto) {
    return this.updateSettings.update(actor, dto);
  }
}
