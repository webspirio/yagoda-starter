import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import { CrateStandingBar } from './CrateStandingBar';
import type { CrateStanding } from '@/entities/crate';

/** The client's day-2 example, spec §8.1's table's last row: 500 → 350/50/0. */
const base: CrateStanding = {
  collection_point_id: 'p1',
  allotment: 500,
  received: 500,
  on_hand: 350,
  in_field: 50,
  deposit_units: 30,
  deposit_held: '3600.00',
  with_berry: 0,
  total: 400,
  shortfall: 100,
};

describe('CrateStandingBar', () => {
  it('prints the three figures, the identity line and the context line', () => {
    render(<CrateStandingBar standing={base} />);
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('Received by transfer: 500')).toBeInTheDocument();
    expect(screen.getByText('Empty at the point').parentElement).toHaveTextContent('350');
    expect(screen.getByText('Out with people').parentElement).toHaveTextContent('50');
    expect(screen.getByText('With us, with berries').parentElement).toHaveTextContent('0');
    expect(screen.getByText('Total for the point 400 = 350 + 50 + 0')).toBeInTheDocument();
    expect(screen.getByText('Short of the allotment:')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('says the allotment is complete at shortfall 0', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: 400, shortfall: 0 }} />);
    expect(screen.getByText('Allotment complete')).toBeInTheDocument();
    expect(screen.queryByText('Short of the allotment:')).not.toBeInTheDocument();
  });

  it('prints «over N» once total runs past the allotment', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: 380, shortfall: -20 }} />);
    expect(screen.getByText('Over the allotment:')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.queryByText('Short of the allotment:')).not.toBeInTheDocument();
  });

  /** §6.9/§8.2 — «—», never 0; the identity line still prints, unlike before. */
  it('shows «—» for the allotment and the shortfall when the allotment is unset', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: null, shortfall: null }} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Total for the point 400 = 350 + 50 + 0')).toBeInTheDocument();
  });

  /** §8.4 — no allotment means no «Short of the allotment:»/«Over the allotment:» label at all. */
  it('renders a bare «—» with no shortfall label when the allotment is unset', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: null, shortfall: null }} />);
    expect(screen.queryByText('Short of the allotment:')).not.toBeInTheDocument();
    expect(screen.queryByText('Over the allotment:')).not.toBeInTheDocument();
    expect(screen.queryByText('Allotment complete')).not.toBeInTheDocument();
  });

  it('turns a negative on-hand red and warns, without blocking anything', () => {
    render(<CrateStandingBar standing={{ ...base, on_hand: -5, total: 45 }} />);
    expect(screen.getByText('−5')).toHaveClass('text-destructive');
    expect(
      screen.getByText(/Fewer than zero empty crates: the documents don't add up/),
    ).toBeInTheDocument();
  });

  it('draws no segment wider than its share and never a negative width', () => {
    const { container } = render(
      <CrateStandingBar standing={{ ...base, on_hand: -15, in_field: 195, with_berry: 620 }} />,
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

  it('is accessible', async () => {
    const { container } = render(<CrateStandingBar standing={base} />);
    await expectNoAxeViolations(container);
  });
});
