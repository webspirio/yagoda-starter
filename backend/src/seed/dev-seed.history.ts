import {
  SEED_GRADES,
  SEED_OPERATORS,
  SEED_POINTS,
  SEED_SUPPLIERS,
  type SeedCashCount,
  type SeedIntake,
  type SeedIntakeLine,
  type SeedPayout,
  type SeedShift,
  type SeedTransfer,
} from './dev-seed.data';

/**
 * THE SEASON BEHIND THE CURATED DAY.
 *
 * `dev-seed.data.ts` is hand-written and stays that way: every row there is a
 * case some screen is read against, and `dev-seed.db-spec.ts` asserts exact
 * figures over it. This file is GENERATED data, and the split by file IS the
 * documentation — if a value lives here, no test asserts it by hand.
 *
 * THREE PROPERTIES THIS FILE OWES THE REST OF THE SEED:
 *
 * 1. DETERMINISM. `mulberry32` below is seeded by a constant. Nothing here
 *    reads the clock, the environment or `Math.random`. A seed whose output
 *    moved between runs could not be idempotent, because the receipt code —
 *    the natural key every insert is looked up by — is derived from this data.
 *
 * 2. INVISIBILITY TO THE CURATED CASH CHAIN. `dev-seed.db-spec.ts` asserts that
 *    Шипинки holds exactly 20 910.00, Конищів 12 800.00 and Гайове 500.00.
 *    Those figures flow from the anchors in `SEED_CASH_COUNTS`, and a naive
 *    backfill would move all three — every generated receipt and payout would
 *    flow down the chain into them. It does not, because `anchor` OVERRIDES the
 *    computed expectation (`dev-seed.ts`: `c.anchor ?? ...`), and the LAST
 *    closing this file generates for each curated point carries that point's
 *    curated anchor as its own. The chain therefore arrives at the curated day
 *    holding exactly the figure the curated day expects: continuous for a
 *    reader, unchanged for the assertions.
 *
 * 3. NON-NEGATIVE BALANCES. `dev-seed.db-spec.ts` proves no seeded supplier
 *    balance is negative, and `PayoutsService` enforces a real debt ceiling. A
 *    generated payout is therefore a QUARTER of what that same supplier has
 *    been received for, tracked as this file generates — never a round number
 *    chosen for looks.
 *
 * 4. A DRAWER THAT NEVER GOES NEGATIVE. `CHK_cash_counts_counted_non_negative`
 *    is a real constraint, and a RECEIPT PUTS NO CASH IN THE DRAWER — the cash
 *    formula (`point-cash.service.ts`) is «transfers accepted MINUS payouts»,
 *    with receipts absent from it entirely. `SEED_TRANSFERS`'s own header says
 *    what happens without the funding side: «without these, every seeded point
 *    pays out money it never received and reads as deeply negative». So every
 *    generated payout is funded by a generated transfer of EXACTLY its amount,
 *    accepted the same business date. The drawer therefore sits at the point's
 *    anchor for the whole season — which is also what makes property 2 above
 *    honest rather than a jump: the last generated closing already equals the
 *    curated anchor before it is forced to.
 *
 * WHAT IS DELIBERATELY NOT GENERATED: `grade_prices`. Prices carry over until
 * changed (spec 2026-09-07 §8.1 removed `business_date`), so the historical
 * price IS the current one. Writing a row per day would silently re-introduce
 * the daily scheme that slice removed.
 */

/** Days of generated history, ending the day before `yesterday`. */
export const HISTORY_DAYS = 30;

/**
 * What `SEED_CASH_COUNTS` anchors each point on. Stated here rather than
 * imported, because this file must LAND on these figures and a silent drift
 * between the two would be invisible on screen and fatal in the db-spec.
 * `dev-seed.spec.ts` asserts these still match the curated rows.
 */
export const CURATED_ANCHOR: Readonly<Record<string, string>> = {
  Шипинки: '5000.00',
  Конищів: '3000.00',
  Гайове: '2500.00',
};

/** Opening figure for a point the curated dataset never counts. */
const DEFAULT_ANCHOR = '2000.00';

/**
 * The points that trade in the generated history: every active reception point,
 * which includes Попівці and Михайлівці. `dev-seed.data.ts` keeps those two
 * without a shift ON PURPOSE, «so the "open one first" state is reachable» —
 * and that stays true, because this file only ever writes days 2 and older.
 * Today and yesterday remain the curated dataset's alone.
 */
const WORKING = SEED_POINTS.filter((p) => p.is_active && p.kind === 'reception').map((p) => p.name);

/** A tiny deterministic PRNG. Not cryptography — reproducibility. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x59414741);

/** An integer in [lo, hi]. */
const between = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));

/**
 * Kopiykas to a canonical decimal string — the only money formatter in this
 * file. Integer arithmetic throughout: no value here ever passes through a
 * binary float, which is the same rule `backend/src/common/money.ts` enforces
 * on the API side.
 */
function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const operatorAt = new Map(
  SEED_OPERATORS.filter((o) => o.is_active).map((o) => [o.point, o.login] as const),
);
const suppliersAt = new Map(
  WORKING.map(
    (p) =>
      [
        p,
        SEED_SUPPLIERS.filter((s) => s.point === p && s.is_active).map(
          (s) => `${s.first_name} ${s.last_name}`,
        ),
      ] as const,
  ),
);
const activeGrades = SEED_GRADES.filter((g) => g.is_active);

const shifts: SeedShift[] = [];
const intakes: SeedIntake[] = [];
const payouts: SeedPayout[] = [];
const cashCounts: SeedCashCount[] = [];
const transfers: SeedTransfer[] = [];

/**
 * Running "owed" per supplier, in kopiykas, as a CEILING rather than a claim.
 * The real amount is the server's — `buildIntake()` works on net weight after
 * the pallet and the tare, plus the line's bonus — and is therefore always
 * LOWER than the gross-times-price figure tracked here. Paying a quarter of a
 * ceiling stays comfortably under the true debt, which is what keeps the
 * db-spec's «no negative balance» assertion true.
 */
const owedCents = new Map<string, number>();

// Day 1 is `yesterday` and belongs to the curated dataset, so history runs from
// day HISTORY_DAYS + 1 up to day 2 (the day before yesterday). The loop counts
// DOWN so these arrays come out CHRONOLOGICAL: `SEED_CASH_COUNTS` order is
// load-bearing, because each opening count reads the point's previous count as
// its expectation.
for (let day = HISTORY_DAYS + 1; day >= 2; day -= 1) {
  const first = day === HISTORY_DAYS + 1;
  const last = day === 2;

  for (const point of WORKING) {
    const operator = operatorAt.get(point);
    const roster = suppliersAt.get(point) ?? [];
    if (!operator || roster.length === 0) continue;

    // NO `broken` (#110) — absent means 0, and that is deliberate. A
    // PRNG-driven breakage would put a moving number in a file whose whole
    // point is that it is byte-identical on every run; the curated dataset
    // carries the non-zero case instead.
    shifts.push({ point, day, openedBy: operator, closed: true });

    // The point's FIRST generated count anchors its whole chain; every later
    // opening reads the previous closing, as §6.1 requires.
    cashCounts.push({
      point,
      day,
      kind: 'opening',
      time: '07:30',
      countedBy: operator,
      ...(first ? { anchor: CURATED_ANCHOR[point] ?? DEFAULT_ANCHOR } : {}),
      drift: '0.00',
    });

    const receipts = between(3, 8);
    for (let n = 0; n < receipts; n += 1) {
      const supplier = roster[between(0, roster.length - 1)];
      const grade = activeGrades[between(0, activeGrades.length - 1)];
      const grossCents = between(1500, 9000);
      const lines: SeedIntakeLine[] = [
        {
          product: grade.product,
          grade: grade.name,
          gross_kg: money(grossCents),
          pallet_kg: money(between(100, 400)),
          bonus: money(between(-10, 10) * 100),
          tare: [{ type: 'Ящик', units: between(1, 6) }],
        },
      ];
      intakes.push({
        point,
        day,
        // The dataset's HANDLE, not the stored code — `dev-seed.ts` numbers
        // each shift 001, 002, … the way the server does. Unique within
        // (point, day) by construction, since the index is in the string, which
        // is all a handle has to be.
        typed: `H${String(day).padStart(2, '0')}${String(n).padStart(2, '0')}`,
        supplier,
        receivedBy: operator,
        time: `${String(8 + n).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}`,
        lines,
      });
      const key = `${point}/${supplier}`;
      const rate = Number(grade.base_price.slice(0, grade.base_price.indexOf('.')));
      owedCents.set(key, (owedCents.get(key) ?? 0) + Math.floor((grossCents * rate) / 100));
    }

    // One payout a day, to whoever at this point is owed most, and only a
    // quarter of it — see `owedCents` above for why a quarter is safe.
    const prefix = `${point}/`;
    const owed = [...owedCents.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort((a, b) => b[1] - a[1])[0];
    if (owed && owed[1] > 20000) {
      const amountCents = Math.floor(owed[1] / 4 / 100) * 100;
      payouts.push({
        point,
        day,
        typed: `H${String(day).padStart(2, '0')}P0`,
        supplier: owed[0].slice(prefix.length),
        paidBy: operator,
        time: '18:15',
        amount: money(amountCents),
      });
      owedCents.set(owed[0], owed[1] - amountCents);

      // The funding side, accepted the SAME business date — `movementsSql`
      // joins a transfer to a shift on `accepted_date`, so a transfer accepted
      // any other day would not fund this payout. Exactly the payout's amount:
      // see property 4 in this file's header for why it is not a penny more.
      transfers.push({
        point,
        day,
        sentAt: '08:10',
        cash: money(amountCents),
        crates: between(10, 40),
        carrier: 'Іван, Ducato',
        status: 'accepted',
        acceptedBy: operator,
        acceptedAt: '08:40',
      });
    }

    // The LAST generated closing lands on the curated anchor — property 2 in
    // this file's header. Every other closing simply agrees with the drawer.
    cashCounts.push({
      point,
      day,
      kind: 'closing',
      time: '19:05',
      countedBy: operator,
      ...(last && CURATED_ANCHOR[point] ? { anchor: CURATED_ANCHOR[point] } : {}),
      drift: '0.00',
    });
  }
}

export const HISTORY_SHIFTS: readonly SeedShift[] = shifts;
export const HISTORY_INTAKES: readonly SeedIntake[] = intakes;
export const HISTORY_PAYOUTS: readonly SeedPayout[] = payouts;
export const HISTORY_CASH_COUNTS: readonly SeedCashCount[] = cashCounts;
export const HISTORY_TRANSFERS: readonly SeedTransfer[] = transfers;
