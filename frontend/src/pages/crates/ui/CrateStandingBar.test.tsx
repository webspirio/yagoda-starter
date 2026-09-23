import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrateStandingBar } from './CrateStandingBar';
import type { CrateStanding } from '@/entities/crate';

const base: CrateStanding = {
  collection_point_id: 'p1', allotment: 800, in_field: 195, deposit_units: 115,
  deposit_held: '13800.00', at_base: 264, on_hand: 341, shortfall: 459,
};

describe('CrateStandingBar', () => {
  it('prints the three figures and the identity line', () => {
    render(<CrateStandingBar standing={base} />);
    expect(screen.getByText('800 = 341 + 195 + 264')).toBeInTheDocument();
    expect(screen.getByText('Empty at the point').parentElement).toHaveTextContent('341');
    expect(screen.getByText('Out with people').parentElement).toHaveTextContent('195');
    expect(screen.getByText('With us, with berries').parentElement).toHaveTextContent('264');
    expect(screen.getByText('459')).toBeInTheDocument();
  });

  /** §6.9 — «—», never 0; and no identity to state without an allotment. */
  it('shows «—» and no identity line when the allotment is unset', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: null, on_hand: null }} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/=/)).not.toBeInTheDocument();
    expect(screen.getByText(/no allotment has been set/i)).toBeInTheDocument();
  });

  it('turns a negative on-hand red and says why, without blocking anything', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: 800, on_hand: -15, at_base: 620 }} />);
    expect(screen.getByText('−15')).toHaveClass('text-destructive');
    expect(screen.getByText(/does not cover this day/i)).toBeInTheDocument();
  });

  it('draws no segment wider than its share and never a negative width', () => {
    const { container } = render(
      <CrateStandingBar standing={{ ...base, on_hand: -15, in_field: 195, at_base: 620 }} />,
    );
    const segments = [...container.querySelectorAll<HTMLElement>('[data-segment]')];
    expect(segments).toHaveLength(3);
    const widths = segments.map((el) => el.style.width);
    const onHandWidth = segments.find((el) => el.dataset.segment === 'onHand')?.style.width;
    expect(onHandWidth).toBe('0%');
    expect(widths.every((w) => !w.startsWith('-') && w !== 'NaN%')).toBe(true);
    const total = widths.reduce((sum, w) => sum + parseFloat(w), 0);
    expect(total).toBeCloseTo(100, 2);
  });
});
