import { afterEach, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpandableText } from './expandable-text';

// jsdom has no layout: every height reads 0. Fake an overflowing clamp.
function overflow(scroll: number, client: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scroll);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(client);
}

afterEach(() => vi.restoreAllMocks());

it('offers «Show more» when the clamp hides text, and expands it in place', async () => {
  const user = userEvent.setup();
  overflow(120, 40);
  render(<ExpandableText>довге пояснення</ExpandableText>);

  const text = screen.getByText('довге пояснення');
  expect(text).toHaveClass('line-clamp-2');

  await user.click(screen.getByRole('button', { name: 'Show more' }));
  expect(text).not.toHaveClass('line-clamp-2');

  await user.click(screen.getByRole('button', { name: 'Collapse' }));
  expect(text).toHaveClass('line-clamp-2');
});

it('shows no toggle when the whole text already fits', () => {
  overflow(40, 40);
  render(<ExpandableText>коротко</ExpandableText>);
  expect(screen.getByText('коротко')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});
