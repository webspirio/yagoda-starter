import { ReweighReconciliationService } from './reweigh-reconciliation.service';
import { UserRole } from '../users/user-role.enum';

// `sub`, not `id` — matches the real `AuthenticatedUser` shape
// (`auth/jwt.strategy.ts`); see `reweighs.service.spec.ts`'s own note.
const owner = { sub: 'u-owner', role: UserRole.NetworkOwner, collection_point_id: null } as never;

describe('ReweighReconciliationService.forShift', () => {
  const build = (shift: Record<string, unknown>, rows: Record<string, unknown>[]) => {
    // `items` (§5.3) is read through the repository, not through `query`;
    // the empty list keeps these cases about the PRODUCT arithmetic, which
    // is all this spec ever asserted. `reweigh-reconciliation.db-spec.ts`
    // is where the item list is proven, because what matters there is that
    // the relations are really loaded.
    const dataSource = {
      query: jest.fn(async () => rows),
      getRepository: jest.fn(() => ({ find: jest.fn(async () => []) })),
    };
    const shifts = { findOneRaw: jest.fn(async () => shift) };
    return new ReweighReconciliationService(dataSource as never, shifts as never);
  };

  const raspberry = {
    product_id: 'p-rasp',
    product_name: 'Малина',
    product_grade_id: 'g-rasp-1',
    intake_net_kg: '800.00',
    intake_amount: '128000.00',
    reweigh_net_kg: '790.00',
  };

  it('computes §8.2 exactly: −10 кг → −1 600,00 ₴', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [raspberry]);
    const out = await svc.forShift(owner, 's-1');
    const p = out.products[0];
    expect(p.state).toBe('weighed');
    expect(p.missing_kg).toBe('10.00');
    expect(p.missing_amount).toBe('1600.00');
  });

  it('prices недостача at what was ACTUALLY paid, bonuses included — spec §3.6', async () => {
    // 800 кг accrued 132 000 because of a +5 ₴/кг bonus → 165,00 ₴/кг, not 160,00
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      { ...raspberry, intake_amount: '132000.00' },
    ]);
    const out = await svc.forShift(owner, 's-1');
    expect(out.products[0].missing_amount).toBe('1650.00');
  });

  it('reports «—» while the shift is still open — spec §3.9', async () => {
    const svc = build({ id: 's-1', closed_at: null }, [raspberry]);
    const out = await svc.forShift(owner, 's-1');
    expect(out.products[0].missing_kg).toBeNull();
    expect(out.products[0].missing_amount).toBeNull();
  });

  it('marks a product with NO reweigh line as not_reweighed, never as zero — §8.2, §8.6', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      { ...raspberry, reweigh_net_kg: null },
    ]);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.state).toBe('not_reweighed');
    expect(p.missing_kg).toBeNull();
  });

  it('marks a PARTIALLY weighed product as not_reweighed — spec §3.15', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      raspberry,
      {
        ...raspberry,
        product_grade_id: 'g-rasp-2',
        intake_net_kg: '50.00',
        intake_amount: '7500.00',
        reweigh_net_kg: null,
      },
    ]);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.state).toBe('not_reweighed');
  });

  it('surfaces a surplus as a signed number rather than hiding it — §8.2 надлишок', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, [
      { ...raspberry, reweigh_net_kg: '805.00' },
    ]);
    const p = (await svc.forShift(owner, 's-1')).products[0];
    expect(p.missing_kg).toBe('-5.00');
  });

  it('says so when the point accepted nothing that day — §8.1', async () => {
    const svc = build({ id: 's-1', closed_at: new Date() }, []);
    const out = await svc.forShift(owner, 's-1');
    expect(out.accepted_anything).toBe(false);
    expect(out.products).toEqual([]);
  });
});
