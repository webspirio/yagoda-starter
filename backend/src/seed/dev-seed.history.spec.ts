import {
  CURATED_ANCHOR,
  HISTORY_CASH_COUNTS,
  HISTORY_DAYS,
  HISTORY_INTAKES,
  HISTORY_PAYOUTS,
  HISTORY_SHIFTS,
  HISTORY_TRANSFERS,
} from './dev-seed.history';
import { SEED_CASH_COUNTS, SEED_SUPPLIERS, daysBack } from './dev-seed.data';

const money = /^-?\d+\.\d{2}$/;

/**
 * The generated season's own consistency. Nothing here asserts a GENERATED
 * FIGURE by hand — that is the whole point of the curated/generated split — it
 * asserts the PROPERTIES `dev-seed.history.ts`'s header promises, because those
 * are what the rest of the seed leans on.
 */
describe('generated history', () => {
  it('covers the days BEFORE the curated pair, never today or yesterday', () => {
    for (const s of HISTORY_SHIFTS) expect(daysBack(s.day)).toBeGreaterThanOrEqual(2);
    for (const i of HISTORY_INTAKES) expect(daysBack(i.day)).toBeGreaterThanOrEqual(2);
    for (const p of HISTORY_PAYOUTS) expect(daysBack(p.day)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...HISTORY_SHIFTS.map((s) => daysBack(s.day)))).toBe(HISTORY_DAYS + 1);
  });

  it('closes every generated shift — an open shift in the past is a bug on screen', () => {
    for (const s of HISTORY_SHIFTS) expect(s.closed).toBe(true);
  });

  it('gives every generated receipt a supplier of its own point', () => {
    const roster = new Set(SEED_SUPPLIERS.map((s) => `${s.point}/${s.first_name} ${s.last_name}`));
    for (const i of HISTORY_INTAKES) expect(roster.has(`${i.point}/${i.supplier}`)).toBe(true);
    for (const p of HISTORY_PAYOUTS) expect(roster.has(`${p.point}/${p.supplier}`)).toBe(true);
  });

  /**
   * The db-spec proves no seeded balance is negative, and `PayoutsService`
   * enforces a real ceiling, so a generated payout above what the supplier is
   * owed would fail the seed outright. The ceiling used here (gross times the
   * whole-hryvnia price) is ABOVE the server's own figure, which works on net
   * weight, so passing this is the conservative side of the real rule.
   */
  it('never pays a supplier more than that supplier was received for', () => {
    const ceiling = new Map<string, number>();
    for (const i of HISTORY_INTAKES) {
      const key = `${i.point}/${i.supplier}`;
      const kg = i.lines.reduce((n, l) => n + Number(l.gross_kg), 0);
      ceiling.set(key, (ceiling.get(key) ?? 0) + kg * 100);
    }
    const paid = new Map<string, number>();
    for (const p of HISTORY_PAYOUTS) {
      const key = `${p.point}/${p.supplier}`;
      paid.set(key, (paid.get(key) ?? 0) + Number(p.amount));
    }
    expect(paid.size).toBeGreaterThan(0);
    for (const [key, amount] of paid) expect(amount).toBeLessThan(ceiling.get(key) ?? 0);
  });

  it('writes money as canonical decimal strings', () => {
    for (const p of HISTORY_PAYOUTS) expect(p.amount).toMatch(money);
    for (const c of HISTORY_CASH_COUNTS) expect(c.drift).toMatch(money);
    for (const i of HISTORY_INTAKES)
      for (const l of i.lines) {
        expect(l.gross_kg).toMatch(money);
        expect(l.pallet_kg).toMatch(money);
        expect(l.bonus).toMatch(money);
      }
  });

  it('gives every generated document a code the schema accepts', () => {
    const code = /^[A-Z0-9][A-Z0-9-]{0,15}$/;
    for (const i of HISTORY_INTAKES) expect(i.typed).toMatch(code);
    for (const p of HISTORY_PAYOUTS) expect(p.typed).toMatch(code);
    for (const i of HISTORY_INTAKES) expect(i.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('gives every generated receipt a code unique within its point and day', () => {
    const seen = new Set<string>();
    for (const i of HISTORY_INTAKES) {
      const key = `${i.point}/${daysBack(i.day)}/${i.typed}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('gives every generated document a shift of its own', () => {
    const shifts = new Set(HISTORY_SHIFTS.map((s) => `${s.point}/${daysBack(s.day)}`));
    for (const d of [...HISTORY_INTAKES, ...HISTORY_PAYOUTS, ...HISTORY_CASH_COUNTS])
      expect(shifts.has(`${d.point}/${daysBack(d.day)}`)).toBe(true);
  });

  /**
   * PROPERTY 4 of the file header. A receipt puts no cash in the drawer — the
   * cash formula is «transfers accepted minus payouts» — so an unfunded payout
   * walks the drawer straight into `CHK_cash_counts_counted_non_negative`. This
   * is the test that would have caught that before Postgres did.
   */
  it('funds every generated payout with a transfer accepted the same day', () => {
    const funded = new Map<string, string>();
    for (const t of HISTORY_TRANSFERS) {
      expect(t.status).toBe('accepted');
      funded.set(`${t.point}/${daysBack(t.day)}`, t.cash);
    }
    expect(HISTORY_TRANSFERS).toHaveLength(HISTORY_PAYOUTS.length);
    for (const p of HISTORY_PAYOUTS)
      expect(funded.get(`${p.point}/${daysBack(p.day)}`)).toBe(p.amount);
  });

  /**
   * Order is load-bearing: `dev-seed.ts` walks these in array order and each
   * opening count reads the point's PREVIOUS count as its expectation. Out of
   * order, a past day would anchor off a future one.
   */
  it('is chronological, oldest day first', () => {
    const order = HISTORY_CASH_COUNTS.map((c) => daysBack(c.day));
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });

  /**
   * PROPERTY 2 of the file header, and the reason `dev-seed.db-spec.ts` can
   * still assert Шипинки 20 910.00 after a season was inserted in front of it.
   */
  it('lands each curated point last generated closing on that point anchor', () => {
    for (const [point, anchor] of Object.entries(CURATED_ANCHOR)) {
      const closings = HISTORY_CASH_COUNTS.filter((c) => c.point === point && c.kind === 'closing');
      expect(closings.length).toBeGreaterThan(0);
      expect(closings[closings.length - 1].anchor).toBe(anchor);
    }
  });

  it('anchors each point first generated count and nothing in between', () => {
    for (const point of new Set(HISTORY_CASH_COUNTS.map((c) => c.point))) {
      const own = HISTORY_CASH_COUNTS.filter((c) => c.point === point);
      expect(own[0].anchor).toBeDefined();
      const middle = own.slice(1, -1);
      for (const c of middle) expect(c.anchor).toBeUndefined();
    }
  });

  /**
   * `CURATED_ANCHOR` is a COPY of figures that live in `dev-seed.data.ts`, and a
   * copy that silently drifts from its original is exactly the failure this
   * whole design is built to avoid. This is the test that keeps the two equal.
   */
  it('agrees with the anchors the curated dataset actually uses', () => {
    for (const [point, anchor] of Object.entries(CURATED_ANCHOR)) {
      const curated = SEED_CASH_COUNTS.find((c) => c.point === point && c.anchor !== undefined);
      expect(curated).toBeDefined();
      expect(curated!.anchor).toBe(anchor);
    }
  });
});
