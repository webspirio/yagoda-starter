import { toReweighItemResponse } from './reweigh-item.mapper';
import type { ReweighItem } from './reweigh-item.entity';

const line = (tareWeight: string, tare: { id: string; units: number; weight: string }[]) =>
  ({
    id: 'ri-1',
    reweigh_id: 'r-1',
    item_order: 1,
    product_grade_id: 'g-1',
    gross_kg: '300.60',
    pallet_kg: '15.60',
    tare_weight_kg: tareWeight,
    net_kg: '227.40',
    weighed_by_user_id: 'u-1',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: new Date('2026-10-19T08:00:00Z'),
    tare: tare.map((t) => ({
      item_id: 'ri-1',
      tare_type_id: t.id,
      units: t.units,
      tare_type: { id: t.id, name: t.id, weight_kg: t.weight },
    })),
  }) as unknown as ReweighItem;

/** W4 — «300,60 − 15,60 − 48 × 1,20 = 227,40» needs a per-unit weight that
 *  reproduces the SNAPSHOT, never just the catalogue's current one. */
describe('toReweighItemResponse — tare[].unit_weight_kg', () => {
  it('uses the catalogue weight while it still reproduces the stored tare', () => {
    const out = toReweighItemResponse(line('57.60', [{ id: 'crate', units: 48, weight: '1.20' }]));
    expect(out.tare[0].unit_weight_kg).toBe('1.20');
  });

  it('recovers a single type’s snapshot weight once the catalogue has moved', () => {
    const out = toReweighItemResponse(line('57.60', [{ id: 'crate', units: 48, weight: '1.30' }]));
    expect(out.tare[0].unit_weight_kg).toBe('1.20');
  });

  it('answers null for every type when a mixed line cannot be proven', () => {
    const out = toReweighItemResponse(
      line('60.00', [
        { id: 'crate', units: 48, weight: '1.30' },
        { id: 'lub', units: 8, weight: '0.30' },
      ]),
    );
    expect(out.tare.map((t) => t.unit_weight_kg)).toEqual([null, null]);
  });

  it('answers null when the stored total does not divide back exactly', () => {
    const out = toReweighItemResponse(line('10.00', [{ id: 'crate', units: 3, weight: '1.20' }]));
    expect(out.tare[0].unit_weight_kg).toBeNull();
  });
});
