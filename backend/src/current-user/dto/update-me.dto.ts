import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * `display_name` is deliberately absent: it is no longer a column, and an
 * operator does not rename themselves — the owner names staff through
 * PATCH /users/:id.
 */
export class UpdateMeDto {
  /** Kept in step with the locales `frontend/src/shared/lib/i18n` registers.
   *  Adding a locale means extending BOTH lists — nothing enforces that
   *  across the stack, so the two can silently drift. */
  @IsOptional()
  @IsString()
  @IsIn(['en'])
  language_code?: string;
}
