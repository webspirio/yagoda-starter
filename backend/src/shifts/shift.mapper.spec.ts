import { toShiftResponse } from './shift.mapper';
import { ShiftStatus } from './shift-status.enum';
import type { Shift } from './shift.entity';

const shift = (over: Partial<Shift> = {}): Shift =>
  ({
    id: 'sh-1',
    collection_point_id: 'p-1',
    opened_by_user_id: 'u-op',
    closed_by_user_id: null,
    business_date: '2026-09-22',
    closed_at: null,
    status: ShiftStatus.Open,
    explanation: null,
    operator_note: null,
    broken_crates: null,
    created_at: new Date('2026-09-22T04:30:00.000Z'),
    updated_at: new Date('2026-09-22T04:30:00.000Z'),
    ...over,
  }) as Shift;

describe('toShiftResponse', () => {
  it('resolves opened_by_name from the caller’s map (D-8)', () => {
    const names = new Map([['u-op', 'Оксана Ткач']]);

    expect(toShiftResponse(shift(), names, false).opened_by_name).toBe('Оксана Ткач');
  });

  it('reads opened_by_name as null when the id is not in the map', () => {
    expect(toShiftResponse(shift(), new Map(), false).opened_by_name).toBeNull();
  });

  it('reads closed_by_name as null on an open shift, without consulting the map', () => {
    const names = new Map([['u-op', 'Оксана Ткач']]);

    expect(toShiftResponse(shift({ closed_by_user_id: null }), names, false).closed_by_name).toBeNull();
  });

  it('resolves closed_by_name once the shift is closed', () => {
    const names = new Map([
      ['u-op', 'Оксана Ткач'],
      ['u-owner', 'Ігор Бондар'],
    ]);
    const closed = shift({
      closed_by_user_id: 'u-owner',
      closed_at: new Date('2026-09-22T18:00:00.000Z'),
      status: ShiftStatus.Closed,
    });

    expect(toShiftResponse(closed, names, false).closed_by_name).toBe('Ігор Бондар');
  });

  it('reads closed_by_name as null when a closed shift’s closer is not in the map', () => {
    const closed = shift({
      closed_by_user_id: 'u-owner',
      closed_at: new Date('2026-09-22T18:00:00.000Z'),
      status: ShiftStatus.Closed,
    });

    expect(toShiftResponse(closed, new Map(), false).closed_by_name).toBeNull();
  });

  it('carries the operator note and the caller’s editable flag through unchanged', () => {
    const res = toShiftResponse(shift({ operator_note: 'віддав решту' }), new Map(), true);
    expect(res.operator_note).toBe('віддав решту');
    expect(res.operator_note_editable).toBe(true);
  });
});
