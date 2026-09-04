/**
 * A `createQueryBuilder()` double for mocked (non-DB) specs. Records the CHAIN —
 * which entity a builder targeted, what it `.set()`, which `.where()` guards it
 * carried — rather than substring-matching generated SQL. Like any mock it is
 * incapable of noticing that a statement does not parse, which is why the
 * `*.db-spec.ts` suites exist; assert Postgres semantics there.
 */
export interface RecordedCall {
  method: string;
  args: unknown[];
}

export type RecordedBuilder = RecordedCall[];

export interface QueryBuilderRecorder {
  createQueryBuilder: jest.Mock;
  /** Every chain created, in creation order. */
  builders: RecordedBuilder[];
}

const CHAIN_METHODS = [
  'insert',
  'into',
  'values',
  'orIgnore',
  'update',
  'set',
  'where',
  'andWhere',
  'returning',
  'setParameter',
] as const;

export interface ExecuteResult {
  affected?: number;
  raw?: unknown[];
}

export const recordQueryBuilders = (
  executeResult: ExecuteResult = { affected: 1, raw: [] },
): QueryBuilderRecorder => {
  const builders: RecordedBuilder[] = [];
  const createQueryBuilder = jest.fn(() => {
    const calls: RecordedBuilder = [];
    builders.push(calls);
    const qb: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of CHAIN_METHODS) {
      qb[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return qb;
      };
    }
    qb.execute = (...args: unknown[]) => {
      calls.push({ method: 'execute', args });
      return Promise.resolve(executeResult);
    };
    return qb;
  });
  return { createQueryBuilder, builders };
};

export const firstArgs = (builder: RecordedBuilder, method: string): unknown[] | undefined =>
  builder.find((c) => c.method === method)?.args;

export const called = (builder: RecordedBuilder, method: string): boolean =>
  builder.some((c) => c.method === method);

/** Chains whose `method` call named `target` — e.g. every `.update(User)`. */
export const targeting = (
  builders: RecordedBuilder[],
  method: string,
  target: unknown,
): RecordedBuilder[] => builders.filter((b) => firstArgs(b, method)?.[0] === target);

export const setValues = (builder: RecordedBuilder): Record<string, unknown> =>
  (firstArgs(builder, 'set')?.[0] ?? {}) as Record<string, unknown>;

/**
 * The predicate calls that survive into the statement: everything from the LAST
 * `.where()` onward.
 * `.where()` RESETS the condition list (`this.expressionMap.wheres = []`) while
 * `.andWhere()` pushes onto it. Joining ALL of them with ' AND ' would certify a
 * WHERE the builder never emits: turning one `.andWhere('status = :processing')`
 * into `.where(…)` — one word, and both read as "a where clause" — silently drops
 * the `id` predicate and makes the statement hit every `processing` row.
 */
const effectiveWheres = (builder: RecordedBuilder): RecordedCall[] => {
  const predicates = builder.filter((c) => c.method === 'where' || c.method === 'andWhere');
  const lastReset = predicates.map((c) => c.method).lastIndexOf('where');
  return lastReset === -1 ? predicates : predicates.slice(lastReset);
};

export const whereText = (builder: RecordedBuilder): string =>
  effectiveWheres(builder)
    .map((c) => String(c.args[0]))
    .join(' AND ');

export const whereParams = (builder: RecordedBuilder): Record<string, unknown> =>
  effectiveWheres(builder).reduce<Record<string, unknown>>(
    (acc, c) => Object.assign(acc, (c.args[1] ?? {}) as Record<string, unknown>),
    {},
  );
