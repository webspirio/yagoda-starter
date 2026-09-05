import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * Deliberately weaker than the account-creation password policy: login must
 * accept any credential that was acceptable when it was created. A length or
 * character rule here would turn every future tightening of that policy into
 * a silent lockout of existing accounts. The upper bounds are DoS guards, not
 * policy.
 */
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
