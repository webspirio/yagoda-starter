import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { UserRole } from '../../users/user-role.enum';

export class CreateUserDto {
  @IsString()
  @Length(1, 64)
  first_name: string;

  @IsString()
  @Length(1, 64)
  last_name: string;

  /** Not an email: §5.7's own reasoning applies to staff too — a point
   *  operator may have no address at all, and a login is what they actually
   *  type. Whitespace is excluded so two logins can never differ by an
   *  invisible character. */
  @IsString()
  @Length(3, 64)
  @Matches(/^\S+$/, { message: 'login must not contain whitespace' })
  login: string;

  /** The password policy for NEW credentials. Tighten it freely — LoginDto
   *  deliberately has no length rule, so tightening never locks out an
   *  existing account. */
  @IsString()
  @Length(8, 128)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  /** Required for a point_operator, forbidden for a network_owner — see
   *  CHK_users_role_point. UserAdminService checks it before the database has
   *  to. `@IsOptional()` (rather than the `@ValidateIf` used on the NOT NULL
   *  fields above) because this column IS nullable: an explicit `null` is
   *  exactly what a network_owner carries, and must be accepted. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string | null;
}
