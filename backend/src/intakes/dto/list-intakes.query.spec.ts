import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListIntakesQueryDto } from './list-intakes.query';

const parse = (q: Record<string, unknown>) =>
  validateSync(plainToInstance(ListIntakesQueryDto, q));

describe('ListIntakesQueryDto.expand', () => {
  it('accepts the one value the register names', () => {
    expect(parse({ expand: 'items' })).toHaveLength(0);
  });

  it('is optional — the default list must stay callable without it', () => {
    expect(parse({})).toHaveLength(0);
  });

  it('refuses anything else, so a typo cannot silently mean «no expansion»', () => {
    expect(parse({ expand: 'item' })).not.toHaveLength(0);
    expect(parse({ expand: 'true' })).not.toHaveLength(0);
  });
});
