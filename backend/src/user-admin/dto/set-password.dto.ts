import { IsString, Length } from 'class-validator';

/**
 * No `current_password`: the owner is ISSUING a password, not changing their
 * own. There is no self-service change endpoint — §17.2's reading is that a
 * password checked at the point, where the owner is not standing, is an
 * access control rather than a signature, so the owner administers it.
 */
export class SetPasswordDto {
  @IsString()
  @Length(8, 128)
  password: string;
}
