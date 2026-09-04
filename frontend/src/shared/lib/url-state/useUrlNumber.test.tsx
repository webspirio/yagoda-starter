import { describe, it, expect } from 'vitest';
import { renderAt } from './harness';
import { useUrlNumber } from './useUrlNumber';

function Probe() {
  const [value, setValue] = useUrlNumber('page');
  return (
    <>
      <span data-testid="value">{value === null ? 'NULL' : String(value)}</span>
      <button onClick={() => setValue(4)}>write</button>
    </>
  );
}

const read = () => document.querySelector('[data-testid="value"]')?.textContent;

describe('useUrlNumber', () => {
  it('is null when the param is absent', () => {
    renderAt('/l', <Probe />);
    expect(read()).toBe('NULL');
  });

  it('reads a positive integer', () => {
    renderAt('/l?page=7', <Probe />);
    expect(read()).toBe('7');
  });

  it('round-trips a written value', () => {
    const view = renderAt('/l', <Probe />);
    view.click('write');
    expect(read()).toBe('4');
  });

  /*
   * The URL is user-editable and shareable, so every non-value has to collapse
   * to "absent" rather than reach a caller as NaN, 0 or a negative page — each
   * of which would go out on the wire as a page number the backend rejects.
   */
  it.each(['abc', '', '0', '-3', '1.5', '1e3'])('treats %o as absent', (raw) => {
    renderAt(`/l?page=${raw}`, <Probe />);
    expect(read()).toBe('NULL');
  });
});
