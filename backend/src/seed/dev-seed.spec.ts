import { addMoney, isoDaysBefore } from './dev-seed';
import { HISTORY_INTAKES } from './dev-seed.history';
import {
  SEED_GRADES,
  SEED_INTAKES,
  SEED_OPERATORS,
  SEED_PAYOUTS,
  SEED_POINTS,
  SEED_PRICE_CHANGES,
  SEED_PRICE_LIMITS,
  SEED_PRODUCTS,
  SEED_SHIFTS,
  SEED_SUPPLIERS,
  SEED_TARE_TYPES,
  SEED_TOP_UPS,
  SEED_TRANSFERS,
  daysBack,
} from './dev-seed.data';

/**
 * The dataset's internal consistency — every reference resolves, every money
 * value is already at the scale Postgres stores it, every phone is E.164 —
 * so a typo in the fixture fails here, in a unit test, rather than as a
 * foreign-key or CHECK violation half-way through a transaction.
 */
describe('dev seed dataset', () => {
  const money = /^\d{1,8}\.\d{2}$/;
  const pointNames = new Set(SEED_POINTS.map((p) => p.name));
  const productNames = new Set(SEED_PRODUCTS);
  const gradeKeys = new Set(SEED_GRADES.map((g) => `${g.product}/${g.name}`));

  it('point codes are unique and shaped for CHK_collection_points_code', () => {
    const codes = SEED_POINTS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{2,8}$/);
  });

  it('every grade belongs to a seeded product', () => {
    for (const g of SEED_GRADES) expect(productNames.has(g.product)).toBe(true);
  });

  it("keeps one product without grades — the mock's «товар без сортів» case", () => {
    const withGrades = new Set(SEED_GRADES.map((g) => g.product));
    expect(SEED_PRODUCTS.filter((p) => !withGrades.has(p))).toEqual(['Кизил']);
  });

  it('seeds no «ОПТ» grade — a reporting marker on the supplier, never a grade', () => {
    for (const g of SEED_GRADES) expect(g.name.toUpperCase()).not.toContain('ОПТ');
  });

  it('every operator and supplier sits on a seeded point', () => {
    for (const u of SEED_OPERATORS) expect(pointNames.has(u.point)).toBe(true);
    for (const s of SEED_SUPPLIERS) expect(pointNames.has(s.point)).toBe(true);
  });

  it("operator logins are unique, lowercase and never the dev owner's", () => {
    const logins = SEED_OPERATORS.map((u) => u.login);
    expect(new Set(logins).size).toBe(logins.length);
    for (const login of logins) {
      expect(login).toBe(login.toLowerCase());
      expect(login).not.toBe('admin');
    }
  });

  it('supplier phones are E.164 and unique within a point (UQ_suppliers_point_phone)', () => {
    const seen = new Set<string>();
    for (const s of SEED_SUPPLIERS) {
      if (s.phone === null) continue;
      expect(s.phone).toMatch(/^\+[1-9][0-9]{7,14}$/);
      const key = `${s.point}/${s.phone}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('money is written at scale 2, the scale Postgres echoes back', () => {
    for (const g of SEED_GRADES) expect(g.base_price).toMatch(money);
    for (const t of SEED_TARE_TYPES) {
      expect(t.weight_kg).toMatch(money);
      expect(t.deposit_price).toMatch(money);
    }
    for (const p of SEED_POINTS) if (p.target_cash !== null) expect(p.target_cash).toMatch(money);
    for (const c of SEED_PRICE_CHANGES) expect(c.base_price).toMatch(money);
    expect(SEED_PRICE_LIMITS.max_markup).toMatch(money);
    expect(SEED_PRICE_LIMITS.max_discount).toMatch(money);
  });

  it('no point offset pushes an active grade below zero (CHK_grade_prices_base_price)', () => {
    for (const p of SEED_POINTS.filter((p) => p.is_active)) {
      for (const g of SEED_GRADES.filter((g) => g.is_active)) {
        expect(addMoney(g.base_price, p.price_offset)).toMatch(money);
      }
    }
  });

  it('every intraday correction targets an active point and an active grade', () => {
    const active = new Map(SEED_POINTS.map((p) => [p.name, p.is_active]));
    for (const c of SEED_PRICE_CHANGES) {
      expect(active.get(c.point)).toBe(true);
      expect(gradeKeys.has(`${c.product}/${c.grade}`)).toBe(true);
      const grade = SEED_GRADES.find((g) => g.product === c.product && g.name === c.grade);
      expect(grade?.is_active).toBe(true);
    }
  });
});

describe('dev seed documents', () => {
  const money = /^-?\d{1,8}\.\d{2}$/;
  const shiftKeys = new Set(SEED_SHIFTS.map((s) => `${s.point}/${s.day}`));
  const supplierKeys = new Set(
    SEED_SUPPLIERS.map((s) => `${s.point}/${s.first_name} ${s.last_name}`),
  );
  const activeGrades = new Set(
    SEED_GRADES.filter((g) => g.is_active).map((g) => `${g.product}/${g.name}`),
  );
  const tareNames = new Set(SEED_TARE_TYPES.map((t) => t.name));
  const operators = new Set(SEED_OPERATORS.filter((u) => u.is_active).map((u) => u.login));
  const active = new Map(SEED_POINTS.map((p) => [p.name, p.is_active]));

  it('every shift is on a working point and the operator who opens it works there', () => {
    const pointOf = new Map(SEED_OPERATORS.map((u) => [u.login, u.point]));
    for (const s of SEED_SHIFTS) {
      expect(active.get(s.point)).toBe(true);
      expect(pointOf.get(s.openedBy)).toBe(s.point);
    }
  });

  it('every document sits in a seeded shift, names a seeded supplier of that point and an active operator', () => {
    for (const d of [...SEED_INTAKES, ...SEED_PAYOUTS]) {
      expect(shiftKeys.has(`${d.point}/${d.day}`)).toBe(true);
      expect(supplierKeys.has(`${d.point}/${d.supplier}`)).toBe(true);
      expect(operators.has('receivedBy' in d ? d.receivedBy : d.paidBy)).toBe(true);
      expect(d.typed).toMatch(/^[A-Z0-9][A-Z0-9-]{0,15}$/);
      expect(d.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('typed receipt numbers are unique per point, day and kind (UQ on the composed code)', () => {
    const seen = new Set<string>();
    for (const [kind, docs] of [
      ['IN', SEED_INTAKES],
      ['PO', SEED_PAYOUTS],
    ] as const) {
      for (const d of docs) {
        const key = `${d.point}/${d.day}/${kind}/${d.typed}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('intake lines use active grades, seeded tare types, at least one tare line, and money at scale 2', () => {
    for (const d of SEED_INTAKES) {
      expect(d.lines.length).toBeGreaterThan(0);
      for (const l of d.lines) {
        expect(activeGrades.has(`${l.product}/${l.grade}`)).toBe(true);
        expect(l.tare.length).toBeGreaterThan(0);
        for (const t of l.tare) {
          expect(tareNames.has(t.type)).toBe(true);
          expect(t.units).toBeGreaterThan(0);
        }
        expect(l.gross_kg).toMatch(money);
        expect(l.pallet_kg).toMatch(money);
        expect(l.bonus).toMatch(money);
      }
    }
    for (const p of SEED_PAYOUTS) expect(p.amount).toMatch(/^\d{1,8}\.\d{2}$/);
  });

  it('a disputed transfer carries everything DisputeTransferDto makes mandatory', () => {
    // THE SEED STORES WHAT THE API WOULD HAVE STORED, and a dispute is the
    // three fields «Не сходиться» writes at once: the cash counted, the crates
    // counted, and the comment that is the entire reason the document reaches
    // the owner. A row with a NULL note and NULL crates against 20 crates is a
    // shape no route can produce — `crates_discrepancy` comes back `null` on a
    // transfer whose whole point is that something did not add up.
    for (const t of SEED_TRANSFERS.filter((x) => x.status === 'disputed')) {
      expect(t.reportedCash).toMatch(money);
      expect(typeof t.reportedCrates).toBe('number');
      expect(t.disputeNote?.trim()).toBeTruthy();
    }
  });

  it('every payout goes to a supplier who has a seeded receipt at that point', () => {
    const paid = new Set(SEED_INTAKES.map((d) => `${d.point}/${d.supplier}`));
    for (const p of SEED_PAYOUTS) expect(paid.has(`${p.point}/${p.supplier}`)).toBe(true);
  });

  it('every top-up addresses a seeded intake by (point, day, typed) — never a composed code', () => {
    // BOTH HALVES, exactly as `seedDev` walks them: a top-up may address a
    // generated receipt as readily as a curated one, and the runner resolves it
    // the same way. Reading the curated array alone here would reject the very
    // rows that give the supplier card a timeline worth looking at.
    const intakeKeys = new Set(
      [...HISTORY_INTAKES, ...SEED_INTAKES].map((d) => `${d.point}/${d.day}/${d.typed}`),
    );
    for (const t of SEED_TOP_UPS) {
      expect(intakeKeys.has(`${t.point}/${t.day}/${t.typed}`)).toBe(true);
      expect(t.amount).toMatch(/^\d{1,8}\.\d{2}$/);
      expect(t.reason.trim()).toBeTruthy();
    }
  });
});

describe('addMoney', () => {
  it('adds decimal strings in integer cents and renders at scale 2', () => {
    expect(addMoney('140.00', '-5')).toBe('135.00');
    expect(addMoney('25.00', '-6')).toBe('19.00');
    expect(addMoney('0.10', '0.2')).toBe('0.30');
    expect(addMoney('60', '5')).toBe('65.00');
    expect(addMoney('1.05', '-1.05')).toBe('0.00');
  });

  it('keeps a negative result signed', () => {
    expect(addMoney('1.00', '-2.50')).toBe('-1.50');
  });

  it('rejects anything that is not a plain decimal', () => {
    expect(() => addMoney('1e3', '0')).toThrow(/Not a decimal/);
    expect(() => addMoney('1.005', '0')).toThrow(/Not a decimal/);
  });
});

describe('SeedDay', () => {
  it('maps a numeric day to that many days before today', () => {
    expect(daysBack('today')).toBe(0);
    expect(daysBack('yesterday')).toBe(1);
    expect(daysBack(30)).toBe(30);
  });
});

describe('isoDaysBefore', () => {
  it('walks back across a month boundary', () => {
    expect(isoDaysBefore('2026-09-15', 0)).toBe('2026-09-15');
    expect(isoDaysBefore('2026-09-15', 1)).toBe('2026-09-14');
    expect(isoDaysBefore('2026-09-15', 30)).toBe('2026-08-16');
  });

  it('walks back across a leap day', () => {
    expect(isoDaysBefore('2028-03-01', 1)).toBe('2028-02-29');
  });
});
