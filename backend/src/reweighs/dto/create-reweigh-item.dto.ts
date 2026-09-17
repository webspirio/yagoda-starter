import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

/** A decimal string with at most two places — the only shape `money.ts` accepts. */
const DECIMAL = /^\d+(\.\d{1,2})?$/;

export class ReweighTareLineDto {
  @IsUUID()
  tare_type_id: string;

  @IsInt()
  @IsPositive()
  units: number;
}

export class CreateReweighItemDto {
  @IsUUID()
  product_grade_id: string;

  @Matches(DECIMAL, { message: 'gross_kg must be a decimal with at most 2 places' })
  gross_kg: string;

  @IsOptional()
  @Matches(DECIMAL, { message: 'pallet_kg must be a decimal with at most 2 places' })
  pallet_kg?: string;

  /**
   * The BREAKDOWN, not a total. `tare_weight_kg` is never accepted from the
   * client — it is computed from the catalogue and snapshotted (§2.5, §2.7).
   */
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ReweighTareLineDto)
  tare: ReweighTareLineDto[];
}
