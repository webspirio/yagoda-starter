import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * `collection_point_id` IS ACCEPTED FROM THE BODY, and that is a documented
 * exception to `point-scope.ts`'s rule that a point is derived from the actor
 * and «never accepted from a request body». Price writes are OWNER-ONLY and an
 * owner has no point, so there is nothing to derive it from;
 * `assertOwnsPoint` validates it in the service (an owner may act on any
 * point). This is the first caller to take that branch.
 *
 * All three numbers are REQUIRED. `max_markup` and `max_discount` have no
 * default anywhere and nothing to inherit from — see `GradePrice`'s doc
 * comment for why nullable would reopen the `target_crates` trap.
 *
 * All three are `numeric(10,2)` — 8 integer digits — carried as STRINGS. The
 * pattern accepts no sign, which is the first half of "zero yes, negative no";
 * the three CHECK constraints are the real guarantee.
 *
 * `@CanonicalDecimal()` sits below `@Matches` on all three so `'52'` is stored
 * and echoed as `'52.00'`, the exact scale Postgres holds it at. Without it,
 * `POST` answers `{"base_price":"52"}` while the next `GET` answers
 * `{"base_price":"52.00"}` for the same row — unequal as strings, and these
 * values are compared as strings, never as numbers.
 */
export class CreateGradePriceDto {
  @IsUUID()
  collection_point_id: string;

  @IsUUID()
  product_grade_id: string;

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
