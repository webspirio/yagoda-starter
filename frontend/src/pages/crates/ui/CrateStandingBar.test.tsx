import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import { CrateStandingBar } from './CrateStandingBar';
import type { CrateStanding } from '@/entities/crate';

/** The client's day-2 example, spec §8.1's table's last row: 500 → 350/50/0. */
const base: CrateStanding = {
  collection_point_id: 'p1',
  allotment: 500,
  received: 500,
  on_hand: 350,
  in_transit: 0,
  in_field: 50,
  deposit_units: 30,
  deposit_held: '3600.00',
  with_berry: 0,
  total: 400,
  shortfall: 100,
  holders: 2,
};

/** The identity line — its operands are boxed terms, so it is read as one text. */
const identity = () => document.querySelector('[data-identity]') as HTMLElement;

describe('CrateStandingBar', () => {
  it('prints the three figures, the identity line and the context line', () => {
    render(<CrateStandingBar standing={base} />);
    // Stand-alone figures carry their unit.
    expect(screen.getByText('500 cr.')).toBeInTheDocument();
    expect(screen.getByText('Received by transfer: 500 cr.')).toBeInTheDocument();
    expect(screen.getByText('Empty at the point').parentElement).toHaveTextContent('350');
    expect(screen.getByText('Out with people').parentElement).toHaveTextContent('50');
    expect(screen.getByText('With us, with berries').parentElement).toHaveTextContent('0');
    expect(screen.getByText('Empty at the point').parentElement).toHaveTextContent('350 cr.');
    expect(identity()).toHaveTextContent('Total for the point 400 cr. = 350 cr. + 50 cr. + 0 cr.');
    expect(screen.getByText('Short of the allotment:')).toBeInTheDocument();
    expect(screen.getByText('100 cr.')).toBeInTheDocument();
  });

  // Audit 2026-10-24, F6: crates on the road are not empties yet — the bar says so.
  it('names crates still on the road, and says nothing when none are', () => {
    const { rerender } = render(<CrateStandingBar standing={{ ...base, in_transit: 40 }} />);
    expect(
      screen.getByText('On the road: 40 cr. — the transfer is not accepted yet'),
    ).toBeInTheDocument();
    rerender(<CrateStandingBar standing={base} />);
    expect(screen.queryByText(/On the road/)).not.toBeInTheDocument();
  });

  it('says the allotment is complete at shortfall 0', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: 400, shortfall: 0 }} />);
    expect(screen.getByText('Allotment complete')).toBeInTheDocument();
    expect(screen.queryByText('Short of the allotment:')).not.toBeInTheDocument();
  });

  it('prints «over N» once total runs past the allotment', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: 380, shortfall: -20 }} />);
    expect(screen.getByText('Over the allotment:')).toBeInTheDocument();
    expect(screen.getByText('20 cr.')).toBeInTheDocument();
    expect(screen.queryByText('Short of the allotment:')).not.toBeInTheDocument();
  });

  /** §6.9/§8.2 — «—», never 0; the identity line still prints, unlike before. */
  it('shows «—» for the allotment and the shortfall when the allotment is unset', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: null, shortfall: null }} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(identity()).toHaveTextContent('Total for the point 400 cr. = 350 cr. + 50 cr. + 0 cr.');
  });

  /** §8.4 — no allotment means no «Short of the allotment:»/«Over the allotment:» label at all. */
  it('renders a bare «—» with no shortfall label when the allotment is unset', () => {
    render(<CrateStandingBar standing={{ ...base, allotment: null, shortfall: null }} />);
    expect(screen.queryByText('Short of the allotment:')).not.toBeInTheDocument();
    expect(screen.queryByText('Over the allotment:')).not.toBeInTheDocument();
    expect(screen.queryByText('Allotment complete')).not.toBeInTheDocument();
  });

  it('shows a negative on-hand with its minus, in amber — a debt in crates, not an error (§6.9, 23.10.2026)', () => {
    render(<CrateStandingBar standing={{ ...base, on_hand: -5, total: 45 }} />);
    const figure = document.querySelector('p[data-trace="crates:onHand"]');
    expect(figure).toHaveTextContent('−5 cr.');
    expect(figure).toHaveClass('text-amber');
    expect(figure).not.toHaveClass('text-destructive');
    expect(screen.getByText(/it owes people crates/)).toHaveClass('text-amber');
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

  // 24.10 — «звідки це число»: each operand lights the figure it repeats.
  it('traces the identity line to the three figures', () => {
    render(<CrateStandingBar standing={base} />);
    const terms = [...identity().querySelectorAll<HTMLElement>('[data-slot="trace-term"]')];
    expect(terms.map((el) => el.textContent?.replace(/\u00a0/g, ' '))).toEqual([
      '400 cr.',
      '350 cr.',
      '50 cr.',
      '0 cr.',
    ]);

    const inField = screen
      .getByText('Out with people')
      .parentElement!.querySelector('[data-trace]');
    fireEvent.pointerEnter(terms[2]);
    expect(inField).toHaveAttribute('data-trace-hit', 'amber');
    fireEvent.pointerLeave(terms[2]);
    expect(inField).not.toHaveAttribute('data-trace-hit');

    // The total is shown nowhere else — it lights all three figures it sums.
    fireEvent.pointerEnter(terms[0]);
    expect(document.querySelectorAll('p[data-trace][data-trace-hit]')).toHaveLength(3);
  });

  it('is accessible', async () => {
    const { container } = render(<CrateStandingBar standing={base} />);
    await expectNoAxeViolations(container);
  });
});
