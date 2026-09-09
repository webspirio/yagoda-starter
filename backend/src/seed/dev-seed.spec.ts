import { addMoney } from './dev-seed';
import {
  SEED_GRADES,
  SEED_OPERATORS,
  SEED_POINTS,
  SEED_PRICE_CHANGES,
  SEED_PRICE_LIMITS,
  SEED_PRODUCTS,
  SEED_SUPPLIERS,
  SEED_TARE_TYPES,
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
