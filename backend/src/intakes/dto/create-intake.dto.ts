import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/** Unsigned decimal, up to 8 integer digits and 2 places — the shape of
 *  `numeric(10,2)` as a weight. */
const WEIGHT = /^\d{1,8}(\.\d{1,2})?$/;

export class CreateIntakeTareDto {
  @IsUUID()
  tare_type_id: string;

  @IsInt()
  @Min(1)
  units: number;
}

export class CreateIntakeItemDto {
  @IsUUID()
  product_grade_id: string;

  @Matches(WEIGHT, { message: 'gross_kg must be a decimal string with at most 2 decimal places' })
  @CanonicalDecimal()
  gross_kg: string;

  @IsOptional()
  @Matches(WEIGHT, { message: 'pallet_kg must be a decimal string with at most 2 decimal places' })
  @CanonicalDecimal()
  pallet_kg: string = '0.00';

  /**
   * THE ONLY SIGNED FIELD IN THE SLICE, and the leading `-?` is load-bearing.
   * §2.8 — «від'ємний bonus це м'ята чи цвіла ягода»; without it, docking for
   * spoiled fruit is a 400 the operator cannot get past.
   *
   * The RANGE is not checked here: it depends on the price row for this grade
   * at this point, which only the service can read. `intake-lines.ts` applies
   * §2.9's clamp and names the permitted range in the message.
   */
  @IsOptional()
  @Matches(/^-?\d{1,8}(\.\d{1,2})?$/, {
    message: 'bonus must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  bonus: string = '0.00';

  /**
   * REQUIRED, AND WITH NO DEFAULT. §9.1 lists «позиція без тари» among the
   * things the system «не дає провести взагалі» — «Вкажіть кількість тари — без
   * неї брутто пішло б у чисту вагу цілком». An omitted `tare` must FAIL
   * validation rather than quietly become an empty array, which is why there is
   * no `= []` here.
   *
   * §9.2 treats the same case as a warning instead; spec §10.2 records the
   * contradiction and why the strict reading was taken.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateIntakeTareDto)
  tare: CreateIntakeTareDto[];
}

/**
 * ONE POST WRITES THE WHOLE DOCUMENT. §2.3 — one visit is one document with
 * several lines, not several intakes. There is no draft: §2.2 says «до
 * "Прийняти" не зберігається ані половина квитанції, ані чернетка, яку хтось
 * потім знайде і зарахує».
 *
 * WHAT IS ABSENT IS THE DESIGN. No `shift_id` (resolved from the point's open
 * shift), no `business_date`, no `price`, no `tare_weight_kg`, no `net_kg`, no
 * `amount` — every one of those is derived server-side, and accepting any of
 * them would make `grade_prices` decorative and §4.5 unenforceable.
 *
 * `code` JOINED THAT LIST ON 2026-09-18. It used to be the one field the
 * operator copied off the paper receipt book; the client removed that field
 * from the form, and the server now numbers the shift itself
 * (`common/document-code.ts`). With it gone this class is EXACTLY what a
 * preview needs, which is why `PreviewIntakeDto` is now an alias for it rather
 * than a second copy of these three fields.
 */
export class CreateIntakeDto {
  /** Owner only. An operator's point comes from their token and a value naming
   *  another point is refused by `assertOwnsPoint`. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsUUID()
  supplier_id: string;

  /**
   * `@ArrayMinSize(1)` only. §2.3's «стеля 5» is DELIBERATELY NOT ENFORCED
   * (spec §8.7): the ceiling reads as a property of the paper form, and a form
   * can be reprinted. A zero-line intake, by contrast, is an `amount` of 0.00
   * with no meaning behind it.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateIntakeItemDto)
  items: CreateIntakeItemDto[];

  /**
   * §2.1 step ⑥ and §3.1 — «Видано готівкою», the cash handed over in THIS
   * visit, written as a payout in the same transaction as the receipt (spec
   * 2026-09-21 §2.1). Absent or `0.00` writes no payout document at all:
   * §3.7's «видано 0,00 ₴» is an intake with no payout, not a payout of zero
   * (spec §8.6).
   *
   * UNSIGNED, and the ceiling is not checked here: `min(Разом, каса за ягоду)`
   * (§3.6) needs the debt and the drawer, which only the service can read,
   * under a lock. `PreviewIntakeDto` is this same class and simply ignores it.
   */
  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'paid_amount must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  paid_amount?: string;
}
