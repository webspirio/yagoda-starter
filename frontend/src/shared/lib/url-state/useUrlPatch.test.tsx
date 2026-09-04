import { describe, it, expect } from 'vitest';
import { renderAt } from './harness';
import { useUrlPatch } from './useUrlPatch';

function Patcher({ patch }: { patch: Parameters<ReturnType<typeof useUrlPatch>>[0] }) {
  const apply = useUrlPatch();
  return <button onClick={() => apply(patch)}>apply</button>;
}

describe('useUrlPatch', () => {
  /*
   * The reason this exists. Every list setter also resets the page, so a write
   * touches two keys at once. Two sequential `setSearchParams` calls in one
   * tick both read the same un-committed `prev`, so the second silently drops
   * the first — one patch, one navigation, is the fix.
   */
  it('applies several keys in a single write', () => {
    const { seen, click } = renderAt('/l?keep=3', <Patcher patch={{ q: 'abc', page: '2' }} />);
    click('apply');
    const params = new URLSearchParams(seen.search);
    expect(params.get('q')).toBe('abc');
    expect(params.get('page')).toBe('2');
    expect(params.get('keep')).toBe('3');
  });

  it('replaces the history entry rather than pushing', () => {
    const { router, click } = renderAt('/l', <Patcher patch={{ q: 'abc' }} />);
    click('apply');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('deletes a key given null', () => {
    const { seen, click } = renderAt('/l?q=abc', <Patcher patch={{ q: null }} />);
    click('apply');
    expect(seen.search).toBe('');
  });

  it('writes an array as repeated params', () => {
    const { seen, click } = renderAt('/l', <Patcher patch={{ city: ['a', 'b'] }} />);
    click('apply');
    expect(new URLSearchParams(seen.search).getAll('city')).toEqual(['a', 'b']);
  });

  /*
   * An EXPLICITLY empty list is not the same as an absent one: absent means
   * "untouched, use the caller's default" (the user's own saved cities, a
   * list's default cohort, `DEFAULT_STATUS`), while empty means the user
   * cleared it to "all". The distinction is the whole reason `useUrlList`
   * reads `string[] | null`, so it needs an encoding that round-trips.
   */
  it('writes an empty array as a present-but-empty param', () => {
    const { seen, click } = renderAt('/l', <Patcher patch={{ city: [] }} />);
    click('apply');
    expect(new URLSearchParams(seen.search).getAll('city')).toEqual(['']);
  });

  it('replaces an existing array rather than appending to it', () => {
    const { seen, click } = renderAt('/l?city=old', <Patcher patch={{ city: ['a'] }} />);
    click('apply');
    expect(new URLSearchParams(seen.search).getAll('city')).toEqual(['a']);
  });

  it('stringifies a number', () => {
    const { seen, click } = renderAt('/l', <Patcher patch={{ page: 4 }} />);
    click('apply');
    expect(new URLSearchParams(seen.search).get('page')).toBe('4');
  });
});
