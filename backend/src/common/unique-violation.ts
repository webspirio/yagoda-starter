import type { ConflictException } from '@nestjs/common';

/** A 23505 on `constraint` becomes the caller's 409; anything else passes through. Nothing
 *  maps QueryFailedError in this backend, so without this it would reach the client as a 500. */
export function translateUniqueViolation(
  error: unknown,
  constraint: string,
  conflict: () => ConflictException,
): unknown {
  const violation = error as { code?: string; constraint?: string } | null;
  return violation?.code === '23505' && violation.constraint === constraint ? conflict() : error;
}
