import { IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  /**
   * Any unique string — an email address or not. Deliberately NOT validated as
   * an email: this starter never sends mail, so requiring one would be a
   * constraint with no purpose behind it.
   *
   * The character class excludes whitespace and control characters so a
   * username can never differ from another only by an invisible character.
   */
  @IsString()
  @Length(3, 64)
  @Matches(/^\S+$/, { message: 'username must not contain whitespace' })
  username: string;

  /** The password policy. Change it here and it applies to new accounts only —
   *  existing credentials keep working, which is why LoginDto has no length rule. */
  @IsString()
  @Length(8, 128)
  password: string;
}
