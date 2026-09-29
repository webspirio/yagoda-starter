import { NotFoundException } from '@nestjs/common';
import {
  makeIntakesMocks,
  buildIntakes,
  type IntakesMocks,
  oksana,
  elsewhere,
  shift,
  intake,
  INTAKE_ID,
} from '../../testing/unit/intakes.mocks';
import { GetIntakeQuery } from './get-intake.query';

describe('GetIntakeQuery', () => {
  let repo: IntakesMocks['repo'];
  let shifts: IntakesMocks['shifts'];
  let state: IntakesMocks['state'];
  let query: GetIntakeQuery;

  beforeEach(() => {
    const mocks = makeIntakesMocks();
    ({ repo, shifts, state } = mocks);
    query = buildIntakes(mocks).get;

    repo.findOne.mockResolvedValue(intake());
    shifts.findOneRaw.mockResolvedValue(shift());
  });

  it('404s when the intake does not exist', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(query.get(oksana, INTAKE_ID)).rejects.toThrow(NotFoundException);
  });

  it('404s an intake at another point for an operator', async () => {
    await expect(query.get(elsewhere, INTAKE_ID)).rejects.toThrow(NotFoundException);
  });

  it('carries the four row extras alongside the items and payouts', async () => {
    const result = await query.get(oksana, INTAKE_ID);

    expect(result.net_kg).toBe('36.90');
    expect(result.lines_count).toBe(2);
    expect(result.supplier_name).toBe('Іван Коваль');
    expect(result.paid_amount).toBe('0.00');
  });

  it('names the receiver on the detail', async () => {
    const result = await query.get(oksana, INTAKE_ID);

    expect(result.received_by_name).toBe('Оксана Гнатюк');
  });

  it('carries the linked crate return — the receipt widget reads it here', async () => {
    state.crateReturnRows = [
      {
        id: 'cr-1',
        units: 40,
        deposit_refund: '2400.00',
        deposit_units: 20,
        receipt_units: 20,
        voided_at: new Date('2026-09-08T09:00:00.000Z'),
      },
    ];

    const result = await query.get(oksana, INTAKE_ID);

    expect(result.crate_return).toEqual({
      id: 'cr-1',
      units: 40,
      deposit_refund: '2400.00',
      deposit_units: 20,
      receipt_units: 20,
      voided_at: '2026-09-08T09:00:00.000Z',
    });
  });

  it('carries crate_return: null when no crates came back', async () => {
    const result = await query.get(oksana, INTAKE_ID);

    expect(result.crate_return).toBeNull();
  });
});
