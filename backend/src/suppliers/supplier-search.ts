import type { SelectQueryBuilder } from 'typeorm';
import type { Supplier } from './supplier.entity';
import { canonicalizePhone } from './phone';

/** A `q` made only of digits and phone punctuation takes the phone lane.
 *  Unicode dashes are written as code points for the same reason as in
 *  `phone.ts` — a literal range is invisible in review. */
const LOOKS_LIKE_PHONE = /^[+\d\s()\-\u2010-\u2015]+$/;

/**
 * THE supplier search box, shared by `GET /suppliers` and `GET /supplier-totals`
 * so the two cannot drift. The builder's supplier alias MUST be `s`.
 *
 * Phone lane: a FULL number matches its canonical form exactly, a partial one
 * its digit suffix («останні чотири цифри?»); a partial number that
 * `canonicalizePhone` rejects falls back to the suffix rather than 400ing a
 * SEARCH. Pure punctuation reduces to no digits and drops the filter — the
 * same end state as a blank box.
 *
 * Name lane: `%`, `_` and `\` are escaped with a named ESCAPE clause, or `?q=%`
 * would match every supplier in scope.
 *
 * Neither predicate is sargable; at hundreds of suppliers per point that is a
 * cheap scan, and the answer past that is a `pg_trgm` GIN index — additive, not
 * pre-built.
 */
export function applySupplierSearch(qb: SelectQueryBuilder<Supplier>, raw: string | undefined): void {
  const q = raw?.trim();
  if (!q) return;

  if (LOOKS_LIKE_PHONE.test(q)) {
    const digits = q.replace(/\D/g, '');
    if (!digits) return;
    const exact = tryCanonicalize(q);
    if (exact) qb.andWhere('s.phone = :phone', { phone: exact });
    else qb.andWhere('s.phone LIKE :phone', { phone: `%${digits}` });
    return;
  }

  const escaped = q.replace(/[%_\\]/g, '\\$&');
  qb.andWhere("(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')", {
    q: `%${escaped}%`,
  });
}

function tryCanonicalize(raw: string): string | null {
  try {
    return canonicalizePhone(raw);
  } catch {
    return null;
  }
}
