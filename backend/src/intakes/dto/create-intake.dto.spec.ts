import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateIntakeDto } from './create-intake.dto';

const GRADE = '55555555-5555-5555-5555-555555555555';
const CRATE = '66666666-6666-6666-6666-666666666666';
const SUPPLIER = '44444444-4444-4444-4444-444444444444';

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
