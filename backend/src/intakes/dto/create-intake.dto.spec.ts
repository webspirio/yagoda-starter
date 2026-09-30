import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateIntakeDto } from './create-intake.dto';

const GRADE = randomUUID();
const CRATE = randomUUID();
const SUPPLIER = randomUUID();

const body = (over: Record<string, unknown> = {}) => ({
  supplier_id: SUPPLIER,
  items: [{ product_grade_id: GRADE, gross_kg: '42.00', tare: [{ tare_type_id: CRATE, units: 3 }] }],
  ...over,
});

/** The pipe's order: transform first, then validate. */
async function check(plain: Record<string, unknown>) {
  const dto = plainToInstance(CreateIntakeDto, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors };
}

describe('CreateIntakeDto.paid_amount', () => {
  it('is optional — an omitted field validates and stays undefined', async () => {
    const { dto, errors } = await check(body());
    expect(errors).toHaveLength(0);
    expect(dto.paid_amount).toBeUndefined();
  });

  it('accepts an explicit null — «no payout» sent as JSON null, not just omitted', async () => {
    const { dto, errors } = await check(body({ paid_amount: null }));
    expect(errors).toHaveLength(0);
    expect(dto.paid_amount).toBeNull();
  });

  it('canonicalises to two decimals, like every other money field', async () => {
    const { dto, errors } = await check(body({ paid_amount: '500' }));
    expect(errors).toHaveLength(0);
    expect(dto.paid_amount).toBe('500.00');
  });

  it('refuses a comma, a sign and a third decimal', async () => {
    for (const bad of ['12,50', '-1.00', '1.234']) {
      const { errors } = await check(body({ paid_amount: bad }));
      expect(errors.map((e) => e.property)).toEqual(['paid_amount']);
    }
  });
});

describe('CreateIntakeDto.returned_crates', () => {
  it('is optional — absent means no crates came back', async () => {
    const { dto, errors } = await check(body());
    expect(errors).toEqual([]);
    expect(dto.returned_crates).toBeUndefined();
  });

  it('accepts 0 and a positive integer', async () => {
    for (const ok of [0, 40]) {
      const { dto, errors } = await check(body({ returned_crates: ok }));
      expect(errors).toEqual([]);
      expect(dto.returned_crates).toBe(ok);
    }
  });

  it('refuses a negative, a fraction and a string', async () => {
    for (const bad of [-1, 1.5, '40']) {
      const { errors } = await check(body({ returned_crates: bad }));
      expect(errors.map((e) => e.property)).toEqual(['returned_crates']);
    }
  });
});
