import {
  makeIntakesMocks,
  buildIntakes,
  type IntakesMocks,
  oksana,
  shift,
  intake,
  INTAKE_ID,
} from '../../testing/unit/intakes.mocks';
import { ListIntakesQuery } from './list-intakes.query';

/**
 * §11.5 — the journal every row of which now carries the four columns
 * `intake-row-extras.ts` defines ONCE. `getRawAndEntities` is the seam:
 * TypeORM keeps `raw[n]` aligned with `entities[n]` for a to-one join, so
 * the mock's single row proves the wiring — the alignment claim itself is
 * proven against real Postgres by the Task 6 db-spec, not here.
 */
describe('ListIntakesQuery', () => {
  let repo: IntakesMocks['repo'];
  let query: ListIntakesQuery;
  let qb: {
    innerJoinAndMapOne: jest.Mock;
    innerJoin: jest.Mock;
    addSelect: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getRawAndEntities: jest.Mock;
    getCount: jest.Mock;
    clone: jest.Mock;
  };

  const listQuery = (over: Record<string, unknown> = {}) => ({
    page: 1,
    limit: 20,
    include_voided: true,
    ...over,
  });

  beforeEach(() => {
    const mocks = makeIntakesMocks();
    ({ repo } = mocks);
    query = buildIntakes(mocks).list;

    qb = {
      innerJoinAndMapOne: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({
        entities: [{ ...intake(), shift: shift() }],
        raw: [
          {
            i_id: INTAKE_ID,
            net_kg: '36.90',
            lines_count: 2,
            supplier_name: 'Іван Коваль',
            paid_amount: '0.00',
            open_amount: '1200.00',
          },
        ],
      }),
      getCount: jest.fn().mockResolvedValue(1),
      // `clone()` returns THIS SAME mock object by default (`qb.clone()`
      // called as a method binds `this` to `qb`), so its `getCount` is the
      // one already stocked above — the dedicated clone test below
      // overrides this to prove the real builder is never asked for a
      // count directly.
      clone: jest.fn().mockReturnThis(),
    };
    repo.createQueryBuilder.mockReturnValue(qb);
  });

  it('carries net_kg, lines_count, supplier_name, paid_amount and open_amount on every row', async () => {
    const result = await query.list(oksana, listQuery() as never);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      net_kg: '36.90',
      lines_count: 2,
      supplier_name: 'Іван Коваль',
      paid_amount: '0.00',
      open_amount: '1200.00',
    });
    expect(result.total).toBe(1);
  });

  it('joins suppliers and adds the five extras selects, once each', async () => {
    await query.list(oksana, listQuery() as never);

    expect(qb.innerJoin).toHaveBeenCalledWith(expect.anything(), 'sup', 'sup.id = i.supplier_id');
    expect(qb.addSelect).toHaveBeenCalledTimes(5);
  });

  it('maps each raw row to its OWN entity BY ID, not by array position', async () => {
    // Two intakes with different extras, and the raw rows handed back in
    // the OPPOSITE order from the entities — a positional `raw[n]` read
    // would hand intake TWO's numbers to intake ONE's row (or vice versa)
    // and this test would not notice unless the values actually differ.
    const OTHER_ID = '99999999-9999-9999-9999-999999999999';
    qb.getRawAndEntities.mockResolvedValue({
      entities: [
        { ...intake({ id: INTAKE_ID }), shift: shift() },
        { ...intake({ id: OTHER_ID }), shift: shift() },
      ],
      raw: [
        {
          i_id: OTHER_ID,
          net_kg: '5.00',
          lines_count: 1,
          supplier_name: 'Петро Мельник',
          paid_amount: '100.00',
          open_amount: '0.00',
        },
        {
          i_id: INTAKE_ID,
          net_kg: '36.90',
          lines_count: 2,
          supplier_name: 'Іван Коваль',
          paid_amount: '0.00',
          open_amount: '1200.00',
        },
      ],
    });
    qb.getCount.mockResolvedValue(2);

    const result = await query.list(oksana, listQuery() as never);

    expect(result.data).toHaveLength(2);
    expect(result.data.find((r) => r.id === INTAKE_ID)).toMatchObject({
      net_kg: '36.90',
      lines_count: 2,
      supplier_name: 'Іван Коваль',
      paid_amount: '0.00',
      open_amount: '1200.00',
    });
    expect(result.data.find((r) => r.id === OTHER_ID)).toMatchObject({
      net_kg: '5.00',
      lines_count: 1,
      supplier_name: 'Петро Мельник',
      paid_amount: '100.00',
      open_amount: '0.00',
    });
  });

  it('runs the count on a CLONE of the builder, not the builder itself', async () => {
    // `getCount()` flips `expressionMap.queryEntity` on the builder it
    // runs on; sharing one builder between the two in-flight calls would
    // make them fight over that map.
    const clone = { getCount: jest.fn().mockResolvedValue(1) };
    qb.clone = jest.fn().mockReturnValue(clone);

    await query.list(oksana, listQuery() as never);

    expect(qb.clone).toHaveBeenCalled();
    expect(clone.getCount).toHaveBeenCalled();
  });

  it('throws a programming error, not a 400, when a raw row is missing for an entity', async () => {
    qb.getRawAndEntities.mockResolvedValue({
      entities: [{ ...intake(), shift: shift() }],
      raw: [],
    });

    await expect(query.list(oksana, listQuery() as never)).rejects.toThrow(
      `intake row extras missing for ${INTAKE_ID}`,
    );
  });
});
