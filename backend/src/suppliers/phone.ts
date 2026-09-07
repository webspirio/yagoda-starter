import { BadRequestException } from '@nestjs/common';

/**
 * The ONE place a supplier phone is normalized.
 *
 * `UNIQUE (collection_point_id, phone)` on raw text is worth nothing, and the
 * DBML supplies the proof: it is the argument that deleted the `villages`
 * table, where one village appeared four ways in the client's own book. A
 * phone typed at 06:40 arrives as `0671234567`, `+380671234567`,
 * `067 123 45 67` or `(067) 123-45-67` — four strings, one human, and a plain
 * UNIQUE accepts all four. That yields four independent
 * `Σ intakes − Σ payouts` balances for one person, permanently: §5.4 and §5.5
 * (duplicate detection and merging) were CANCELLED by правки 5 and 6, so there
 * is no merge tool and there will not be one.
 *
 * WHY CANONICAL-ONLY STORAGE, diverging from the catalog slice's "store
 * exactly as typed, compare case-insensitively": «Копайгород» → «копайгород»
 * is data loss, but `067 123 45 67` → `+380671234567` is not. A name's
 * capitalization is content; a phone's dashes are presentation, and a phone
 * number has a canonical form. The catalog pattern's PRINCIPLE is preserved —
 * the database is the real guarantee — by `CHK_suppliers_phone_e164`, which
 * rejects a non-canonical value even if a future code path forgets to call
 * this function.
 *
 * NO `libphonenumber-js`. One country with one expansion rule is this
 * function plus its table-driven spec, and this repo's posture is to add a
 * dependency when something real needs it (`decimal.js` is deferred on the
 * same reasoning). That library is the upgrade path if a second country
 * appears.
 */
const ACCEPTED_FORMS =
  '0XXXXXXXXX, 380XXXXXXXXX, +380XXXXXXXXX, or an international number in E.164 ' +
  '(+ then 8–15 digits). Spaces, dashes and parentheses are ignored.';

/** Ukrainian national form: a leading 0 and nine more digits. */
const UA_NATIONAL = /^0\d{9}$/;
/** Ukrainian international form, with or without the plus. */
const UA_INTERNATIONAL = /^\+?380\d{9}$/;
/** Anything that CLAIMS to be Ukrainian, so a wrong length is rejected rather
 *  than falling through to the permissive international branch below. */
const UA_CLAIMED = /^(\+?380|0)/;
/** E.164: a plus, a non-zero leading digit, 8–15 digits in total. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function canonicalizePhone(raw: string): string {
  // Strip every separator a human might type. The hyphen is escaped and the
  // unicode dashes are written as explicit code points (U+2010 HYPHEN through
  // U+2015 HORIZONTAL BAR) — a paste from a spreadsheet or a phone keyboard
  // produces those, and writing them literally inside a character class makes
  // the range boundaries invisible in review.
  const stripped = raw.replace(/[\s()\-\u2010-\u2015]/g, '');

  if (UA_INTERNATIONAL.test(stripped)) {
    return stripped.startsWith('+') ? stripped : `+${stripped}`;
  }
  if (UA_NATIONAL.test(stripped)) {
    // '0671234567' -> '+38' + '0671234567' = '+380671234567'
    return `+38${stripped}`;
  }
  // Checked BEFORE the generic E.164 branch: '+38012345' has eight digits and
  // would otherwise be accepted as a valid foreign number, silently storing a
  // malformed Ukrainian one.
  if (!UA_CLAIMED.test(stripped) && E164.test(stripped)) {
    return stripped;
  }

  throw new BadRequestException({
    message: `"${raw}" is not a phone number this system can store. Accepted: ${ACCEPTED_FORMS}`,
    code: 'SUPPLIER_PHONE_INVALID',
  });
}
