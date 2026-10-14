import { applySupplierSearch } from './supplier-search';

/** Moved verbatim from the old service's list spec — the `q` lanes are now one
 *  function both `/suppliers` and `/supplier-totals` call. */
describe('applySupplierSearch', () => {
  const run = (q: string | undefined) => {
    const qb = { andWhere: jest.fn().mockReturnThis() };
    applySupplierSearch(qb as never, q);
    return qb.andWhere;
  };
  const NAME_LANE = "(s.first_name ILIKE :q ESCAPE '\\' OR s.last_name ILIKE :q ESCAPE '\\')";

  it('takes the PHONE lane for a digits-only q, matching on the suffix', () => {
    expect(run('45 67')).toHaveBeenCalledWith('s.phone LIKE :phone', { phone: '%4567' });
  });

  it('matches a FULL number exactly, canonicalized', () => {
    expect(run('067 123 45 67')).toHaveBeenCalledWith('s.phone = :phone', { phone: '+380671234567' });
  });

  it('takes the NAME lane for anything else, across both name columns', () => {
    expect(run('Ковал')).toHaveBeenCalledWith(NAME_LANE, { q: '%Ковал%' });
  });

  it('escapes a literal % and _ rather than letting them wildcard-match', () => {
    expect(run('%')).toHaveBeenCalledWith(NAME_LANE, { q: '%\\%%' });
    expect(run('_')).toHaveBeenCalledWith(NAME_LANE, { q: '%\\_%' });
  });

  it('adds nothing for a missing, whitespace-only or pure-punctuation q', () => {
    expect(run(undefined)).not.toHaveBeenCalled();
    expect(run('   ')).not.toHaveBeenCalled();
    expect(run('()')).not.toHaveBeenCalled();
  });

  it('does NOT throw when q is an unparseable phone — search is not entry', () => {
    expect(() => run('4567')).not.toThrow();
  });
});
