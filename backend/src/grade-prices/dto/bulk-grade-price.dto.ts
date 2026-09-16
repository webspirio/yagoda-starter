import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * «ПОСТАВИТИ ВСІМ» — one grade, one set of numbers, many points, one
 * transaction.
 *
 * THE POINTS ARE NAMED BY THE CLIENT rather than computed here as «every
 * reception point», and that is the decision in this file worth arguing.
 * §4.8's warehouse exclusion — «склад… якого жест "поставити всім" НЕ чіпає» —
 * is a rule about the GESTURE, and the screen performing the gesture is where a
 * reader should be able to see which columns it will touch. Computed in the
 * service it becomes an invisible rule the next caller inherits by accident,
 * and a route named `/bulk` that silently skipped one of the ids it was handed
 * would be worse still. Each id is validated through `assertOwnsPoint` exactly
 * as `POST /grade-prices` validates its single one, so nothing is trusted.
 *
 * `ArrayMaxSize(50)` is not a business rule: it is the same instinct as every
 * pagination cap here — an unbounded array is an unbounded transaction.
 *
 * All three numbers are REQUIRED, as they are on `CreateGradePriceDto` and for
 * the same reason: `max_markup` and `max_discount` are NOT NULL with no default
 * and nothing to inherit.
 */
export class BulkGradePriceDto {
  @IsUUID()
  product_grade_id: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  collection_point_ids: string[];

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'base_price must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  base_price: string;

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'max_markup must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  max_markup: string;

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'max_discount must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  max_discount: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
