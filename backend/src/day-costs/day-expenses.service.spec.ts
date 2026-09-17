import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DayExpensesService } from './day-expenses.service';
import { UserRole } from '../users/user-role.enum';

const owner = { sub: 'u-owner', role: UserRole.NetworkOwner, collection_point_id: null } as never;

describe('DayExpensesService', () => {
  const build = () => {
    const repo = {
      save: jest.fn(async (row: unknown) => ({ id: 'e-1', created_at: new Date(), updated_at: new Date(), ...(row as object) })),
      findOne: jest.fn(
        async (): Promise<{ id: string; shift_id: string; label: string; amount: string } | null> => ({
          id: 'e-1',
          shift_id: 's-1',
          label: 'пальне',
          amount: '1000.00',
        }),
      ),
      delete: jest.fn(async () => ({ affected: 1 })),
      find: jest.fn(async () => []),
    };
    const shifts = { findOneRaw: jest.fn(async () => ({ id: 's-1' })) };
    const audit = { record: jest.fn() };
    return {
      service: new DayExpensesService(repo as never, shifts as never, audit as never),
      repo,
      audit,
    };
  };

  it('records a free-text line against the shift — §8.3', async () => {
    const { service, audit } = build();
    const out = await service.create(owner, 's-1', { label: 'пальне', amount: '1000.00' });
    expect(out.label).toBe('пальне');
    expect(out.amount).toBe('1000.00');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'day-expense.created' }),
      undefined,
    );
  });

  it('trims the label and refuses an empty one', async () => {
    const { service } = build();
    await expect(
      service.create(owner, 's-1', { label: '   ', amount: '10.00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('EDITS a row in place — spec §3.8, the one table in this slice that is mutable', async () => {
    const { service, audit } = build();
    const out = await service.update(owner, 'e-1', { amount: '1200.00' });
    expect(out.amount).toBe('1200.00');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'day-expense.updated' }),
      undefined,
    );
  });

  it('deletes a row outright — no void trio here', async () => {
    const { service, audit } = build();
    await service.remove(owner, 'e-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'day-expense.deleted' }),
      undefined,
    );
  });

  it('404s an unknown expense', async () => {
    const { service, repo } = build();
    repo.findOne = jest.fn(async () => null);
    await expect(service.update(owner, 'nope', { amount: '1.00' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
