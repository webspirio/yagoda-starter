import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BooleanQueryParam, toBooleanQueryValue } from './boolean-query-param';

class Query {
  @BooleanQueryParam()
  include_inactive?: boolean;
}

const parse = async (raw: Record<string, unknown>) => {
  const dto = plainToInstance(Query, raw);
  const errors = await validate(dto);
  return { dto, errors };
};

describe('toBooleanQueryValue', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['TRUE', true],
    ['  true  ', true],
    ['false', false],
    ['0', false],
    ['FALSE', false],
  ])('maps %j to %j', (raw, expected) => {
    expect(toBooleanQueryValue(raw)).toBe(expected);
  });

  it('passes a real boolean straight through', () => {
    expect(toBooleanQueryValue(true)).toBe(true);
  });

  // The whole point of the helper: an unrecognised string is NOT silently
  // turned into false. It is returned unchanged so @IsBoolean() rejects it.
  it.each(['2', 'yes', 'on', ''])('leaves %j unchanged for the validator to reject', (raw) => {
    expect(toBooleanQueryValue(raw)).toBe(raw);
  });
});

describe('@BooleanQueryParam()', () => {
  it('accepts an absent field', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toHaveLength(0);
    expect(dto.include_inactive).toBeUndefined();
  });

  it('transforms "1" to true', async () => {
    const { dto, errors } = await parse({ include_inactive: '1' });
    expect(errors).toHaveLength(0);
    expect(dto.include_inactive).toBe(true);
  });

  it('transforms "false" to false', async () => {
    const { dto, errors } = await parse({ include_inactive: 'false' });
    expect(errors).toHaveLength(0);
    expect(dto.include_inactive).toBe(false);
  });

  // This is the bug being closed: under @IsBooleanString() this passed
  // validation and then compared unequal to 'true', i.e. meant false.
  it('rejects "2" instead of silently meaning false', async () => {
    const { errors } = await parse({ include_inactive: '2' });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isBoolean');
  });
});
