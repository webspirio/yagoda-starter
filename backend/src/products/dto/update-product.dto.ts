import { IsString, Length, ValidateIf } from 'class-validator';

/**
 * `@ValidateIf(... !== undefined)` rather than `@IsOptional()`: `name` is a NOT
 * NULL column, and `@IsOptional()` treats an explicit `null` like an absent
 * field, skipping every later validator — so `{"name": null}` would sail
 * through class-validator and crash on the constraint at save time, a 500 where
 * a 400 belongs. `@ValidateIf` skips only a truly ABSENT field.
 *
 * There is no `is_active` here because `products` has no such column, and no
 * `display_order` because this slice does not implement one.
 */
export class UpdateProductDto {
  @ValidateIf((o: UpdateProductDto) => o.name !== undefined)
  @IsString()
  @Length(1, 128)
  name?: string;
}
