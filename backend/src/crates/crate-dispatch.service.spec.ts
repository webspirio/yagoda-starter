import { CrateDispatchService } from './crate-dispatch.service';

describe('CrateDispatchService.forShift', () => {
  const shift = { id: 'shift-1', broken_crates: 3 };
  const shifts = { findOne: jest.fn().mockResolvedValue(shift) };
  const dataSource = { manager: { query: jest.fn() } };

  const make = () => new CrateDispatchService(dataSource as never, shifts as never);

  beforeEach(() => {
    jest.clearAllMocks();
    shifts.findOne.mockResolvedValue(shift);
  });

  it('sums the crates on the shift’s intakes and adds the breakage', async () => {
    dataSource.manager.query.mockResolvedValue([{ with_berry: 142 }]);
    await expect(make().forShift({} as never, 'shift-1')).resolves.toEqual({
      with_berry: 142,
      broken: 3,
      dispatched: 145,
    });
  });

  it('reports 0 for a shift with no intakes — not null', async () => {
    dataSource.manager.query.mockResolvedValue([{ with_berry: 0 }]);
    const result = await make().forShift({} as never, 'shift-1');
    // The query KNOWS there were no crates. That differs from not knowing.
    expect(result.with_berry).toBe(0);
    expect(result.dispatched).toBe(3);
  });

  it('leaves broken and dispatched null while the shift is open', async () => {
    shifts.findOne.mockResolvedValue({ id: 'shift-1', broken_crates: null });
    dataSource.manager.query.mockResolvedValue([{ with_berry: 142 }]);
    await expect(make().forShift({} as never, 'shift-1')).resolves.toEqual({
      with_berry: 142,
      broken: null,
      dispatched: null,
    });
  });

  it('adds a zero breakage rather than treating it as absent', async () => {
    shifts.findOne.mockResolvedValue({ id: 'shift-1', broken_crates: 0 });
    dataSource.manager.query.mockResolvedValue([{ with_berry: 142 }]);
    const result = await make().forShift({} as never, 'shift-1');
    expect(result.broken).toBe(0);
    expect(result.dispatched).toBe(142);
  });

  it('filters voided intakes and non-crate tare in SQL', async () => {
    dataSource.manager.query.mockResolvedValue([{ with_berry: 0 }]);
    await make().forShift({} as never, 'shift-1');
    const [sql] = dataSource.manager.query.mock.calls[0];
    expect(sql).toContain('i.voided_at IS NULL');
    expect(sql).toContain('tt.is_crate');
    // int8 would arrive as a string and land silently in a `number` field.
    expect(sql).toContain('::int');
  });
});
