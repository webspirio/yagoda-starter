import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterButton } from './filter-button';

describe('FilterButton', () => {
  it('opens the filter drawer when tapped', async () => {
    const onClick = vi.fn();
    render(<FilterButton onClick={onClick} activeCount={0} label="Фільтри" />);
    await userEvent.click(screen.getByRole('button', { name: 'Фільтри' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('hides the badge when no filters are active', () => {
    render(<FilterButton onClick={vi.fn()} activeCount={0} label="Фільтри" />);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows the active-filter count on the badge', () => {
    render(<FilterButton onClick={vi.fn()} activeCount={3} label="Фільтри (3)" />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  // The badge is aria-hidden, so the count reaches a screen reader ONLY through
  // the caller-supplied label — this is what would catch a caller passing a
  // bare "Фільтри" and silently dropping the count from the accessible name.
  it('takes its whole accessible name from the label, not the badge', () => {
    render(<FilterButton onClick={vi.fn()} activeCount={3} label="Фільтри (3)" />);

    expect(screen.getByRole('button', { name: 'Фільтри (3)' })).toBeInTheDocument();
  });
});
