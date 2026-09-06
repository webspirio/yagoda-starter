import { BadRequestException } from '@nestjs/common';

/**
 * Trims a display name and rejects an all-whitespace one with a 400 — called
 * BEFORE both the uniqueness check and the save.
 *
 * `@Length(1, 128)` counts whitespace toward length, so " " alone already
 * passes it. Without trimming here, "Малина" and " Малина " render identically
 * everywhere a human reads them but compare unequal to the unique index,
 * defeating the whole point of the constraint. The stakes are not always
 * cosmetic: on a collection point, a transfer typed against a name that reads
 * as an exact duplicate but isn't (only trailing whitespace tells them apart)
 * is real money sent to the wrong place, not just a display nit.
 *
 * It trims and does NOT lowercase: a name is a display value, and rewriting
 * what someone typed is data loss rather than normalization. Case-insensitive
 * COMPARISON is a separate mechanism and lives in the database, as a
 * `lower(name)` unique index. See `normalize-login.ts` for the full argument.
 */
export function assertTrimmedName(raw: string, field: string, code: string): string {
  const name = raw.trim();
  if (!name) {
    throw new BadRequestException({
      message: `${field} cannot be empty or all whitespace`,
      code,
    });
  }
  return name;
}
