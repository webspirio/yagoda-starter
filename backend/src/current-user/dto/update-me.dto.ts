import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  display_name?: string;

  /** Kept in step with the locales `frontend/src/shared/lib/i18n` registers.
   *  Adding a locale means extending BOTH lists — nothing enforces that
   *  across the stack, so the two can silently drift. */
  @IsOptional()
  @IsIn(['en'])
  language_code?: string;
}
