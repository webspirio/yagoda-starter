import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../jwt.strategy';

/** The JWT payload passport attached to the request. Only meaningful on a
 *  route carrying @Auth() — elsewhere it is undefined. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest().user,
);
