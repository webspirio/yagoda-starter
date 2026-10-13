import { describe, it, expect } from 'vitest';
import { emptyLine, toPreviewBody, type IntakeFormValues } from './intakeForm';

function withTare(...units: string[]): IntakeFormValues {
  return {
    supplier_id: 's1',
    items: [{ ...emptyLine('t1'), tare: units.map((u) => ({ tare_type_id: 't1', units: u })) }],
    paid_amount: '',
    returned_crates: '',
  };
}

describe('toPreviewBody — tare counts (#72 / #233 review)', () => {
  it('sends a whole count as a number', () => {
    expect(toPreviewBody(withTare('12', ' 3 '), null).items[0].tare.map((r) => r.units)).toEqual([
      12, 3,
    ]);
  });

  it('drops only an untouched row: empty or 0', () => {
    expect(toPreviewBody(withTare('', '0', '3'), null).items[0].tare.map((r) => r.units)).toEqual([
      3,
    ]);
  });

  it('never sends a count that is not whole — the form refuses it before any request', () => {
    const units = toPreviewBody(withTare('2.5', '1.2.3', '4'), null).items[0].tare.map(
      (r) => r.units,
    );
    expect(units).toEqual([4]);
  });
});
