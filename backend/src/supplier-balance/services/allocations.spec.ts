import { AllocationsService } from './allocations';

describe('AllocationsService', () => {
  const service = new AllocationsService();
  const manager = (reads: unknown[][]) => {
    const query = jest.fn();
    for (const r of reads) query.mockResolvedValueOnce(r);
    query.mockResolvedValue([]);
    return { query } as unknown as import('typeorm').EntityManager & { query: jest.Mock };
  };

  it('lockSupplier takes FOR UPDATE on the supplier row', async () => {
    const m = manager([]);
    await service.lockSupplier(m, 's1');
    expect(m.query).toHaveBeenCalledWith('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [
      's1',
    ]);
  });

  it('release by intake also releases the rows of its top-ups', async () => {
    const m = manager([]);
    await service.release(m, { intakeId: 'i1' });
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toMatch(/SET voided_at = now\(\)/);
    expect(sql).toMatch(
      /intake_top_up_id IN \(SELECT id FROM intake_top_ups WHERE intake_id = \$1\)/,
    );
    expect(params).toEqual(['i1']);
  });

  it.each([
    [{ payoutId: 'p1' }, /payout_id = \$1/, 'p1'],
    [{ topUpId: 't1' }, /intake_top_up_id = \$1/, 't1'],
  ])('release %o touches only live rows of that document', async (target, where, id) => {
    const m = manager([]);
    await service.release(m, target);
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toMatch(/voided_at IS NULL/);
    expect(sql).toMatch(where);
    expect(params).toEqual([id]);
  });

  it('allocate inserts nothing when there is nothing to cover', async () => {
    const m = manager([[], []]);
    await expect(service.allocate(m, 's1')).resolves.toBe(0);
    expect(m.query).toHaveBeenCalledTimes(2);
  });

  it('allocate writes one row per cover, bound first', async () => {
    // Already in queue order — `settle` does not sort, the SQL does.
    const line = (id: string, kind: 'intake' | 'top_up', intake_id: string, amount: string) => ({
      id,
      kind,
      code: 'IN-1',
      intake_id,
      business_date: '2026-07-01',
      created_at: '2026-07-01 08:00',
      amount,
    });
    const m = manager([
      [
        line('r1', 'intake', 'r1', '100.00'),
        line('t1', 'top_up', 'r1', '20.00'),
        line('r22', 'intake', 'r22', '50.00'),
      ],
      [
        {
          id: 'p1',
          code: 'PO-1',
          business_date: '2026-07-02',
          created_at: '2026-07-02 00',
          amount: '80.00',
          intake_id: 'r22',
        },
      ],
    ]);
    await expect(service.allocate(m, 's1')).resolves.toBe(2);
    const [sql, params] = m.query.mock.calls[2];
    expect(sql).toMatch(/INSERT INTO payout_allocations/);
    expect(sql).toMatch(/clock_timestamp\(\)/);
    expect(sql).toMatch(/WITH ORDINALITY/);
    expect(params).toEqual([
      ['p1', 'p1'],
      ['r22', 'r1'],
      [null, null],
      ['50.00', '30.00'],
    ]);
  });

  describe('withinSupplierLedger', () => {
    it('locks, runs the work, then allocates — in that order — and returns the work’s result', async () => {
      const order: string[] = [];
      const lock = jest.spyOn(service, 'lockSupplier').mockImplementation(async () => {
        order.push('lock');
      });
      const alloc = jest.spyOn(service, 'allocate').mockImplementation(async () => {
        order.push('allocate');
        return 0;
      });
      const m = manager([]);
      const out = await service.withinSupplierLedger(m, 's1', async () => {
        order.push('work');
        return 'done';
      });
      expect(out).toBe('done');
      expect(order).toEqual(['lock', 'work', 'allocate']);
      expect(lock).toHaveBeenCalledWith(m, 's1');
      expect(alloc).toHaveBeenCalledWith(m, 's1');
      lock.mockRestore();
      alloc.mockRestore();
    });

    it('does not allocate when the work throws, and rethrows the same error', async () => {
      const lock = jest.spyOn(service, 'lockSupplier').mockResolvedValue(undefined);
      const alloc = jest.spyOn(service, 'allocate').mockResolvedValue(0);
      const boom = new Error('boom');
      await expect(
        service.withinSupplierLedger(manager([]), 's1', async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);
      expect(alloc).not.toHaveBeenCalled();
      lock.mockRestore();
      alloc.mockRestore();
    });
  });
});
