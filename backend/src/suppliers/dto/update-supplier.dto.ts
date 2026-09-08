import { IsBoolean, IsEnum, IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { SupplierKind } from '../supplier-kind.enum';

/**
 * NO `collection_point_id`. §3.9 nails a supplier to a point and debt is
 * filtered by `supplier_id` ALONE — the Note says filtering by point
 * separately is «не треба й не можна». Re-pointing a row would move a real
 * money balance between two points' books with no document explaining it. A
 * supplier entered at the wrong point is DEACTIVATED and recreated, not moved.
 *
 * `first_name`, `last_name`, `kind` and `is_active` back NOT NULL columns and
 * use `@ValidateIf(... !== undefined)` so an explicit null is a 400, not a
 * silently-skipped validator. `phone` and `note` are nullable columns, so
 * their guard admits null deliberately — clearing either is legal.
 */
export class UpdateSupplierDto {
  @ValidateIf((o: UpdateSupplierDto) => o.first_name !== undefined)
  @IsString()
  @Length(1, 128)
  first_name?: string;

  @ValidateIf((o: UpdateSupplierDto) => o.last_name !== undefined)
  @IsString()
  @Length(1, 128)
  last_name?: string;

  @ValidateIf((o: UpdateSupplierDto) => o.phone !== undefined && o.phone !== null)
  @IsString()
  @Length(1, 32)
  phone?: string | null;

  @ValidateIf((o: UpdateSupplierDto) => o.note !== undefined && o.note !== null)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ValidateIf((o: UpdateSupplierDto) => o.kind !== undefined)
  @IsEnum(SupplierKind)
  kind?: SupplierKind;

  @ValidateIf((o: UpdateSupplierDto) => o.is_active !== undefined)
  @IsBoolean()
  is_active?: boolean;
}
