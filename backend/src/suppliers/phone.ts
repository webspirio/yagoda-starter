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
 *
 * WHAT THIS CANNOT CATCH, and why no server-side rule can. `E164` is a SHAPE
 * test, by §5.7's deliberate choice — so a Ukrainian number that loses one
 * digit from its country code still lands somewhere legal and becomes a
 * SECOND ROW for one human:
 *
 *     '+38 (067) 123-45-67' -> +380671234567   the correct row
 *     '+38 67 123 45 67'    -> +38671234567    dropped the national 0
 *     '+30 671234567'       -> +30671234567    dropped the 8
 *     '+80 671234567'       -> +80671234567    dropped the 3
 *
 * Rejecting `+38` + 9 digits does NOT fix this: Ukraine's national number is
 * 9 digits, and its seven `+38x` neighbours' are 8 — so that rule rejects
 * every 11-digit `+38x` number, which is 100% of Slovenia, Bosnia,
 * Montenegro, Kosovo and North Macedonia. `+38671234567` is simultaneously a
 * Ukrainian mistype and a well-formed Slovenian landline; they are the same
 * string, and no shape rule separates them. `libphonenumber-js` does not help
 * either — a leading `+` makes it read the country code, so it parses that as
 * Slovenia and canonicalizes to the same value.
 *
 * The ONLY place this class is catchable is entry: an input mask, or a `+380`
 * prefill, on the supplier form. There is no supplier UI yet. When one is
 * built, that mask is the fix — do not come back and narrow this function.
 *
 * The no-plus and doubled-prefix families ARE closed here: `38671234567`,
 * `+3800…`, `00380…` and the legacy trunk `8…` all 400.
 */
const ACCEPTED_FORMS =
  '0XXXXXXXXX, 380XXXXXXXXX, +380XXXXXXXXX, or an international number in E.164 ' +
  '(+ then 8–15 digits). Spaces, dashes and parentheses are ignored.';

/** Ukrainian national form: a leading 0 and nine more digits. */
const UA_NATIONAL = /^0\d{9}$/;
/** Ukrainian international form, with or without the plus. */
const UA_INTERNATIONAL = /^\+?380\d{9}$/;
/** A `+380`/`380`/`0` prefix, so a value claiming that shape at the WRONG
 *  LENGTH is rejected rather than falling through to the permissive
 *  international branch below. It closes that prefix family only — see the
 *  "what this cannot catch" note above for the near-misses that remain. */
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
