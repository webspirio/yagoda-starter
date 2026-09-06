import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * Both numbers are REQUIRED: the DBML gives neither a default, and a tare type
 * that does not say what it weighs is unusable by §2.5's automatic subtraction.
 *
 * Both are STRINGS, and the regexes are the columns' own shapes —
 * `numeric(10,2)` is 8 integer digits, `numeric(12,2)` is 10. The pattern
 * accepts no sign, which is the first half of "zero yes, negative no"; the
 * CHECK constraints are the real guarantee.
 *
 * `@CanonicalDecimal()` sits below `@Matches` on both fields so the intent
 * reads in order — shape first, then normalise — even though the ValidationPipe
 * actually runs the whole class-transformer pass before class-validator ever
 * sees the value. It exists so `'1.2'` is stored, echoed, and diffed as
 * `'1.20'` — the exact scale Postgres holds it at — instead of surviving in
 * memory as whatever shape the caller happened to type.
 */
export class CreateTareTypeDto {
  @IsString()
  @Length(1, 128)
  name: string;

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: 'weight_kg must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  weight_kg: string;

  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'deposit_price must be a decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  deposit_price: string;

  @IsOptional()
  @IsBoolean()
  is_crate?: boolean;
}
