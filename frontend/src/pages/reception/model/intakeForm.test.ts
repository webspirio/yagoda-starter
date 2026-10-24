import { describe, it, expect } from 'vitest';
import {
  emptyLine,
  toPreviewBody,
  withoutBlankDraft,
  type IntakeFormValues,
} from './intakeForm';

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

describe('withoutBlankDraft — the fresh draft «Ще позиція» leaves behind (client, 24.10)', () => {
  const filled = { ...emptyLine('t1'), product_grade_id: 'g1', gross_kg: '20.00' };
  const form = (...items: IntakeFormValues['items']): IntakeFormValues => ({
    supplier_id: 's1',
    items,
    paid_amount: '',
    returned_crates: '',
  });

  it('drops an untouched trailing draft behind a committed line', () => {
    expect(withoutBlankDraft(form(filled, emptyLine('t1'))).items).toEqual([filled]);
  });

  it('keeps a draft the operator has started — a weight, a grade or a pallet', () => {
    for (const started of [
      { ...emptyLine('t1'), gross_kg: '10' },
      { ...emptyLine('t1'), product_grade_id: 'g2' },
      { ...emptyLine('t1'), pallet_kg: '14.30' },
    ]) {
      expect(withoutBlankDraft(form(filled, started)).items).toHaveLength(2);
    }
  });

  it('never drops the only line, so an empty form still reads as empty', () => {
    expect(withoutBlankDraft(form(emptyLine('t1'))).items).toHaveLength(1);
  });
});
