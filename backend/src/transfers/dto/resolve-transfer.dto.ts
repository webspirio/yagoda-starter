import { IsInt, Matches, Min } from 'class-validator';
import { CanonicalDecimal } from '../../common/dto/canonical-decimal';

/**
 * §7.9 step 4б — the owner closes the dispute. «Після підтвердження у формулу
 * обчислень потрапляє число, яке вказує керівник.»
 *
 * THE STATUS DOES NOT CHANGE. A resolved dispute keeps `status = 'disputed'`
 * forever, with `resolved_at` set — §7.7's «розбіжність у документі лишається,
 * її не підганяють», and the schema's own formula branches on exactly that
 * pair. Flipping it to `accepted` would erase from the record that anything
 * went wrong.
 *
 * WITHOUT THIS PAIR OF FIELDS the only home for the owner's number would be
 * editing `cash` on the posted document — «тихе переписування проведеного
 * документа», which §9.3 forbids.
 */
export class ResolveTransferDto {
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'resolved_cash must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  resolved_cash: string;

  @IsInt()
  @Min(0)
  resolved_crates: number;
}
