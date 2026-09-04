import { describe, it, expect } from 'vitest';
import { renderAt } from './harness';
import { useUrlList } from './useUrlList';

function Probe({ write }: { write?: string[] | null }) {
  const [value, setValue] = useUrlList('city');
  return (
    <>
      <span data-testid="value">{value === null ? 'NULL' : JSON.stringify(value)}</span>
      <button onClick={() => setValue(write ?? null)}>write</button>
    </>
  );
}

const read = () => document.querySelector('[data-testid="value"]')?.textContent;

describe('useUrlList', () => {
  /*
   * `null` (absent) and `[]` (explicitly cleared) are DIFFERENT states, and
   * every caller depends on the difference: an absent param means "untouched,
   * fall back to the default" — the user's own saved cities, a list's
   * default cohort, `DEFAULT_STATUS` — while an empty one means the user
   * widened to "all". Collapsing them would make a default impossible to
   * override.
   */
  it('is null when the param is absent', () => {
    renderAt('/l', <Probe />);
    expect(read()).toBe('NULL');
  });

  it('is an empty array when the param is present but empty', () => {
    renderAt('/l?city=', <Probe />);
    expect(read()).toBe('[]');
  });

  it('reads repeated params in order', () => {
    renderAt('/l?city=a&city=b', <Probe />);
    expect(read()).toBe('["a","b"]');
  });

  it('round-trips a written list', () => {
    const view = renderAt('/l', <Probe write={['a', 'b']} />);
    view.click('write');
    expect(read()).toBe('["a","b"]');
  });

  it('round-trips an explicitly emptied list', () => {
    const view = renderAt('/l?city=a', <Probe write={[]} />);
    view.click('write');
    expect(read()).toBe('[]');
  });

  /*
   * The absent -> explicitly-empty transition, which is invisible to any memo
   * keyed on the joined values alone: `[]` and `['']` both join to `''`. It is
   * the exact move an admin makes by deselecting the last status chip, and
   * getting it wrong pins the dimension on its default forever.
   */
  it('recomputes when an absent param becomes an explicitly empty one', () => {
    const view = renderAt('/l', <Probe write={[]} />);
    expect(read()).toBe('NULL');
    view.click('write');
    expect(read()).toBe('[]');
  });

  it('drops the param when set back to null', () => {
    const view = renderAt('/l?city=a', <Probe write={null} />);
    view.click('write');
    expect(read()).toBe('NULL');
    expect(view.seen.search).toBe('');
  });
});
