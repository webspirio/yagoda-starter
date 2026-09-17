import { allocateTopUps } from './top-up-allocation';
import { sum } from '../common/money';

describe('allocateTopUps', () => {
  it('gives a single-line receipt the whole top-up', () => {
    const out = allocateTopUps([
      { intake_id: 'i-1', top_up_total: '2000.00', lines: [{ product_grade_id: 'g-1', amount: '128000.00' }] },
    ]);
    expect(out.get('g-1')).toBe('2000.00');
  });

  it('splits pro-rata by line amount, not by weight — spec §3.13', () => {
    const out = allocateTopUps([
      {
        intake_id: 'i-1',
        top_up_total: '2000.00',
        lines: [
          { product_grade_id: 'g-1', amount: '128000.00' },
          { product_grade_id: 'g-2', amount: '32000.00' },
        ],
      },
    ]);
    expect(out.get('g-1')).toBe('1600.00');
    expect(out.get('g-2')).toBe('400.00');
  });

  it('loses no kopiyka on an indivisible split — §8.4 звірка', () => {
    const out = allocateTopUps([
      {
        intake_id: 'i-1',
        top_up_total: '100.00',
        lines: [
          { product_grade_id: 'g-1', amount: '1.00' },
          { product_grade_id: 'g-2', amount: '1.00' },
          { product_grade_id: 'g-3', amount: '1.00' },
        ],
      },
    ]);
    expect(sum([...out.values()])).toBe('100.00');
  });

  it('accumulates across receipts that share a grade', () => {
    const out = allocateTopUps([
      { intake_id: 'i-1', top_up_total: '10.00', lines: [{ product_grade_id: 'g-1', amount: '5.00' }] },
      { intake_id: 'i-2', top_up_total: '15.00', lines: [{ product_grade_id: 'g-1', amount: '5.00' }] },
    ]);
    expect(out.get('g-1')).toBe('25.00');
  });

  it('adds two lines of the SAME grade on one receipt into one bucket', () => {
    const out = allocateTopUps([
      {
        intake_id: 'i-1',
        top_up_total: '100.00',
        lines: [
          { product_grade_id: 'g-1', amount: '50.00' },
          { product_grade_id: 'g-1', amount: '50.00' },
        ],
      },
    ]);
    expect(out.get('g-1')).toBe('100.00');
  });

  it('ignores a receipt with no top-up', () => {
    const out = allocateTopUps([
      { intake_id: 'i-1', top_up_total: '0.00', lines: [{ product_grade_id: 'g-1', amount: '5.00' }] },
    ]);
    expect(out.get('g-1') ?? '0.00').toBe('0.00');
  });
});
