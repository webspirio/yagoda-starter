import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UpdateMeDto } from './dto/update-me.dto';

export interface MeResponse {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  language_code: string | null;
}

@Injectable()
export class CurrentUserService {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  async getMe(actor: AuthenticatedUser): Promise<MeResponse> {
    const user = await this.users.findById(actor.sub);
    return this.toResponse(user, actor.username);
  }

  async updateMe(actor: AuthenticatedUser, dto: UpdateMeDto): Promise<MeResponse> {
    const before = await this.users.findById(actor.sub);
    const updated = await this.users.update(actor.sub, dto);

    // Only the fields that actually moved. A no-op PATCH writing an audit
    // entry would make the log unreadable: mostly noise, with the real
    // changes buried in it.
    const changed = (Object.keys(dto) as (keyof UpdateMeDto)[]).filter(
      (key) => before[key] !== updated[key],
    );

    if (changed.length > 0) {
      await this.audit.record({
        action: 'user.updated',
        actor_id: actor.sub,
        target_type: 'user',
        target_id: actor.sub,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, updated[k]])),
      });
    }

    return this.toResponse(updated, actor.username);
  }

  async setAvatar(actor: AuthenticatedUser, url: string | null): Promise<MeResponse> {
    const before = await this.users.findById(actor.sub);
    const updated = await this.users.update(actor.sub, { avatar_url: url });

    await this.audit.record({
      action: 'user.avatar-changed',
      actor_id: actor.sub,
      target_type: 'user',
      target_id: actor.sub,
      before: { avatar_url: before.avatar_url },
      after: { avatar_url: url },
    });

    return this.toResponse(updated, actor.username);
  }

  /** The username lives on the identity row, not on `users`. It is already in
   *  the verified token, so reading it from there costs no extra query. */
  private toResponse(
    user: { id: string; display_name: string | null; avatar_url: string | null; language_code: string | null },
    username: string,
  ): MeResponse {
    return {
      id: user.id,
      username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      language_code: user.language_code,
    };
  }
}
