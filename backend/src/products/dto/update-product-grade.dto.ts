import { IsBoolean, IsString, Length, ValidateIf } from 'class-validator';

/**
 * THERE IS NO `product_id` HERE, and its absence is the rule. Re-parenting a
 * grade rewrites history silently: `intake_items` stores the grade id alone and
 * §4.1 makes the PRODUCT the reporting key, so moving "1 сорт" from Малина to
 * Полуниця moves every receipt line ever written against it into another
 * product's totals — a report correct last month becomes wrong with no document
 * changing. A grade under the wrong product is deactivated and recreated.
 *
 * `@ValidateIf(... !== undefined)` rather than `@IsOptional()` on both fields:
 * both back NOT NULL columns, and `@IsOptional()` would let an explicit `null`
 * skip every validator and reach the database as a 500.
 */
export class UpdateProductGradeDto {
  @ValidateIf((o: UpdateProductGradeDto) => o.name !== undefined)
  @IsString()
  @Length(1, 128)
  name?: string;

  @ValidateIf((o: UpdateProductGradeDto) => o.is_active !== undefined)
  @IsBoolean()
  is_active?: boolean;
}
