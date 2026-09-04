import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../jwt.strategy';

export const ROLES_KEY = 'auth:roles';

/**
 * The role half of `@Auth()`. Applied after JwtAuthGuard, so `request.user` is
 * already populated by JwtStrategy.validate() — which read it from the
 * database this request, not from the token. A role change therefore takes
 * effect on the caller's very next request.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    // Unreachable while @Auth() always applies JwtAuthGuard first. If it ever
    // becomes reachable, "no user" must not read as "no role required".
    if (!user) throw new UnauthorizedException();

    if (!required.includes(user.role)) {
      throw new ForbiddenException({
        message: 'This action is restricted',
        code: 'INSUFFICIENT_ROLE',
      });
    }
    return true;
  }
}
