import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { PendingSlice } from './pending-slice';

it('never renders an em dash — that already means «no target was set»', () => {
  render(<PendingSlice label="Каса за ящики" note="Ящики будуть у наступному слайсі" />);
  expect(screen.queryByText('—')).toBeNull();
  expect(screen.getByText(/наступному слайсі/)).toBeInTheDocument();
});

it('is announced to screen readers as unavailable data, not as a value', () => {
  render(<PendingSlice label="Ящиків" note="…" variant="inline" />);
  expect(screen.getByRole('note')).toBeInTheDocument();
});

it('renders the label too, not only the note', () => {
  render(<PendingSlice label="Каса за ящики" note="Ще не рахується" />);
  expect(screen.getByText('Каса за ящики')).toBeInTheDocument();
});

it('carries the same role="note" and never an em dash in the block variant too', () => {
  render(<PendingSlice label="Каса за ящики" note="Ще не рахується" variant="block" />);
  expect(screen.getByRole('note')).toBeInTheDocument();
  expect(screen.queryByText('—')).toBeNull();
});

it('has no axe violations in either variant', async () => {
  const inline = render(<PendingSlice label="Ящиків" note="…" variant="inline" />);
  await expectNoAxeViolations(inline.container);
  inline.unmount();

  const block = render(<PendingSlice label="Ящиків" note="…" variant="block" />);
  await expectNoAxeViolations(block.container);
});
