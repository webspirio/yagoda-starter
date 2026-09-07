import { IsEnum, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator';
import { SupplierKind } from '../supplier-kind.enum';

/**
 * `collection_point_id` is OPTIONAL here and resolved by the service, not by
 * this DTO: an operator's point is DERIVED from their token and a value they
 * send for someone else's point is a 403, while an OWNER has no point and must
 * name one (400 if absent). Encoding that split in validators is impossible —
 * it depends on the caller's role, which a DTO cannot see.
 *
 * `phone` uses `@ValidateIf(... !== undefined)` rather than `@IsOptional()`
 * because an explicit `null` is MEANINGFUL here — правка 8's «без номеру
 * телефону» — and `@IsOptional()` would treat null as absent. The column is
 * nullable, so null must reach the service.
 */
export class CreateSupplierDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsString()
  @Length(1, 128)
  first_name: string;

  @IsString()
  @Length(1, 128)
  last_name: string;

  /** Any human format; `canonicalizePhone` normalizes it or 400s. */
  @ValidateIf((o: CreateSupplierDto) => o.phone !== undefined && o.phone !== null)
  @IsString()
  @Length(1, 32)
  phone?: string | null;

  @ValidateIf((o: CreateSupplierDto) => o.note !== undefined && o.note !== null)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsEnum(SupplierKind)
  kind?: SupplierKind;
}
