import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { useUrlFlag } from './useUrlFlag';

function renderFlagAt(entry: string) {
  const seen = { value: false, search: '' };
  function Probe() {
    const [open, setOpen] = useUrlFlag('attendees');
    seen.value = open;
    seen.search = useLocation().search;
    return (
      <>
        <button onClick={() => setOpen(true)}>open</button>
        <button onClick={() => setOpen(false)}>close</button>
      </>
    );
  }
  const router = createMemoryRouter([{ path: '*', element: <Probe /> }], {
    initialEntries: [entry],
  });
  const view = render(<RouterProvider router={router} />);
  return { seen, click: (label: string) => act(() => view.getByText(label).click()) };
}

describe('useUrlFlag', () => {
  it('is false when the param is absent', () => {
    expect(renderFlagAt('/e/1').seen.value).toBe(false);
  });

  it('is true when the param is present as 1', () => {
    expect(renderFlagAt('/e/1?attendees=1').seen.value).toBe(true);
  });

  it('writes 1 when raised', () => {
    const { seen, click } = renderFlagAt('/e/1');
    click('open');
    expect(seen.value).toBe(true);
    expect(new URLSearchParams(seen.search).get('attendees')).toBe('1');
  });

  /*
   * Lowered means ABSENT, not `=0`: the URL is shared and bookmarkable, so a
   * closed sheet should leave no trace to explain.
   */
  it('drops the param entirely when lowered', () => {
    const { seen, click } = renderFlagAt('/e/1?attendees=1');
    click('close');
    expect(seen.value).toBe(false);
    expect(seen.search).toBe('');
  });

  it('treats any other value as lowered', () => {
    expect(renderFlagAt('/e/1?attendees=0').seen.value).toBe(false);
  });
});
