import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import { UserRole } from '../../users/user-role.enum';

/**
 * `login` is editable on purpose: users can never be deleted (§5.6), so a
 * login typed wrong at creation would otherwise be permanent — and the person
 * types it every morning.
 *
 * There is no `password` field here; issuing a password is its own endpoint
 * so that it can be audited as a distinct fact.
 *
 * NULL AND ABSENT ARE DIFFERENT HERE, AND THE ASYMMETRY IS THE POINT.
 * `@IsOptional()` treats an explicit `null` exactly like an absent field and
 * SKIPS every subsequent validator, so `{"login": null}` would sail through
 * class-validator untouched and land on a NOT NULL column — a 500 where a 400
 * belongs. `first_name`, `last_name`, `login`, `role` and `is_active` are all
 * NOT NULL, so they use `@ValidateIf((o) => o.x !== undefined)`, which skips
 * validation only when the field is truly ABSENT; an explicit `null` still
 * reaches `@IsString()`/`@IsEnum()`/`@IsBoolean()` and is refused with a 400.
 * Same pattern, same reason as `UpdateCollectionPointDto`.
 *
 * `collection_point_id` is the opposite case and keeps `@IsOptional()`: that
 * column IS nullable, and `null` is not a defect but the only value a
 * network_owner may hold. Sending it explicitly is how an owner clears
 * someone's home point, and `UserAdminService.update` applies it.
 */
export class UpdateUserDto {
  @ValidateIf((o: UpdateUserDto) => o.first_name !== undefined)
  @IsString()
  @Length(1, 64)
  first_name?: string;

  @ValidateIf((o: UpdateUserDto) => o.last_name !== undefined)
  @IsString()
  @Length(1, 64)
  last_name?: string;

  @ValidateIf((o: UpdateUserDto) => o.login !== undefined)
  @IsString()
  @Length(3, 64)
  @Matches(/^\S+$/, { message: 'login must not contain whitespace' })
  login?: string;

  @ValidateIf((o: UpdateUserDto) => o.role !== undefined)
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsUUID()
  collection_point_id?: string | null;

  @ValidateIf((o: UpdateUserDto) => o.is_active !== undefined)
  @IsBoolean()
  is_active?: boolean;
}
