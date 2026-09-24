import type { EntityManager } from 'typeorm';
import { loadDisplayNames } from './display-names';
import { User } from './user.entity';

/**
 * `loadDisplayNames` is the one place a caller turns a batch of user ids into
 * `displayNameOf` results — see the D-8 shift/cash-count responses, which
 * each load ONE map per page rather than querying per row.
 */
describe('loadDisplayNames', () => {
  const find = jest.fn();
  const manager = { find } as unknown as EntityManager;

  beforeEach(() => {
    find.mockReset();
  });

  it('maps two ids to their trimmed "first last" names, in ONE query', async () => {
    find.mockResolvedValue([
      { id: 'u-1', first_name: 'Оксана', last_name: 'Ткач' },
      { id: 'u-2', first_name: 'Ігор', last_name: 'Бондар' },
    ]);

    const names = await loadDisplayNames(manager, ['u-1', 'u-2']);

    expect(names.get('u-1')).toBe('Оксана Ткач');
    expect(names.get('u-2')).toBe('Ігор Бондар');
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(User, expect.objectContaining({ where: expect.anything() }));
  });

  it('leaves an id with no matching row absent from the map', async () => {
    find.mockResolvedValue([{ id: 'u-1', first_name: 'Оксана', last_name: 'Ткач' }]);

    const names = await loadDisplayNames(manager, ['u-1', 'unknown-id']);

    expect(names.has('unknown-id')).toBe(false);
    expect(names.get('u-1')).toBe('Оксана Ткач');
  });

  it('returns an empty map for no ids, without querying at all', async () => {
    const names = await loadDisplayNames(manager, []);

    expect(names.size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });

  it('dedupes repeated ids into the same one query', async () => {
    find.mockResolvedValue([{ id: 'u-1', first_name: 'Оксана', last_name: 'Ткач' }]);

    await loadDisplayNames(manager, ['u-1', 'u-1', 'u-1']);

    expect(find).toHaveBeenCalledTimes(1);
  });
});
