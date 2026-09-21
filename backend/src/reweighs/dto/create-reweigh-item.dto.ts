import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * A weight that `numeric(10,2)` can actually hold: at most 8 integer digits
 * and 2 places, DIGIT-BOUNDED — the same shape and the same bound as
 * `CreateIntakeItemDto`'s `WEIGHT`. An unbounded `\d+` is not merely
 * untidy: this backend maps no `QueryFailedError`
 * (`common/filters/all-exceptions.filter.ts`), so an over-long value
 * reaches Postgres and comes back as an opaque 500 where a 400 belongs.
 */
const WEIGHT = /^\d{1,8}(\.\d{1,2})?$/;

export class ReweighTareLineDto {
  @IsUUID()
  tare_type_id: string;

  /**
   * `@Min(1)` rather than `@IsPositive()`, matching `CreateIntakeTareDto`,
   * and with the UPPER bound that DTO does not need because nothing
   * downstream of it builds a decimal string out of the count.
   * `Number.isInteger(1e21)` is `true`, so `@IsInt()` waves `1e21` through;
   * `ReweighsService` then builds `` `${units}.00` `` and hands
   * `'1e+21.00'` to `money.parse`, which throws — a 500 from a value the
   * edge should have refused.
   */
  @IsInt()
  @Min(1)
  @Max(100_000)
  units: number;
}

export class CreateReweighItemDto {
  @IsUUID()
  product_grade_id: string;

  @Matches(WEIGHT, { message: 'gross_kg must be a decimal with at most 2 places' })
  @CanonicalDecimal()
  gross_kg: string;

  @IsOptional()
  @Matches(WEIGHT, { message: 'pallet_kg must be a decimal with at most 2 places' })
  @CanonicalDecimal()
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
