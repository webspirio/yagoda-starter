import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CostOfDayQueryDto } from './cost-of-day.query';
import { NetworkCostOfDayQueryDto } from './network-cost-of-day.query';

/** Spec 2026-10-24 §4 — `split` is optional, and an unknown value is a 400
 *  (the global ValidationPipe turns these constraints into one), never a
 *  silent fallback to `weight`. */
const errors = (dto: object): string[] =>
  validateSync(dto).flatMap((e) => Object.keys(e.constraints ?? {}));

describe('CostOfDayQueryDto.split', () => {
  it.each(['weight', 'value', 'own'])('accepts %s', (split) => {
    expect(errors(plainToInstance(CostOfDayQueryDto, { split }))).toEqual([]);
  });

  it('is optional', () => {
    expect(errors(plainToInstance(CostOfDayQueryDto, {}))).toEqual([]);
  });

  it('refuses an unknown split', () => {
    expect(errors(plainToInstance(CostOfDayQueryDto, { split: 'bogus' }))).toEqual(['isIn']);
  });
});

describe('NetworkCostOfDayQueryDto.split', () => {
  it('accepts a known split beside the date', () => {
    const dto = plainToInstance(NetworkCostOfDayQueryDto, { date: '2026-10-19', split: 'own' });
    expect(errors(dto)).toEqual([]);
  });

  it('refuses an unknown split', () => {
    const dto = plainToInstance(NetworkCostOfDayQueryDto, { date: '2026-10-19', split: 'bogus' });
    expect(errors(dto)).toEqual(['isIn']);
  });
});
