import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

/**
 * The one blessed way to protect a route:
 *
 *   @Auth()   // any authenticated user
 *
 * This starter ships no authorization — every authenticated user is equal.
 * Keeping every protected route behind this single decorator means adding
 * roles later is a change to this file plus a migration, not an audit of
 * every controller in the codebase.
 */
export function Auth() {
  return applyDecorators(UseGuards(JwtAuthGuard));
}
