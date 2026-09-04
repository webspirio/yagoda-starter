import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { displayNameOf } from '../users/display-name';
import { AuditService } from '../audit/audit.service';
import { MediaService } from '../media/media.service';
import { messageOf } from '../common/errors/message-of';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UpdateMeDto } from './dto/update-me.dto';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.enum';

export interface MeResponse {
  id: string;
  username: string;
  /** DERIVED from first_name + last_name — there is no such column. */
  display_name: string;
  avatar_url: string | null;
  language_code: string | null;
  role: UserRole;
  collection_point_id: string | null;
}

@Injectable()
export class CurrentUserService {
  private readonly logger = new Logger(CurrentUserService.name);

  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
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

    // Delete the file this one replaces, AFTER the row is safely updated —
    // deleting first would destroy the current avatar if the update then failed.
    // Best-effort: a failed cleanup leaves an orphan on disk, which is far
    // better than 500-ing a request whose actual work already succeeded. Without
    // this, every re-upload orphans the previous file forever.
    if (before.avatar_url && before.avatar_url !== url) {
      try {
        await this.media.deleteByUrl(before.avatar_url);
      } catch (err) {
        this.logger.warn(
          `Failed to delete superseded avatar ${before.avatar_url}: ${messageOf(err)}`,
        );
      }
    }

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
  private toResponse(user: User, username: string): MeResponse {
    return {
      id: user.id,
      username,
      display_name: displayNameOf(user),
      avatar_url: user.avatar_url,
      language_code: user.language_code,
      role: user.role,
      collection_point_id: user.collection_point_id,
    };
  }
}
