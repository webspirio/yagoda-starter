import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import { CratesBookCard } from './CratesBookCard';

type Props = Parameters<typeof CratesBookCard>[0];

const card = (over: Partial<Props> = {}) => (
  <CratesBookCard
    crateCash="14400.00"
    crateUnexplained="0.00"
    crateDeposits="14760.00"
    crateDepositUnits={123}
    berryCash="1000.00"
    {...over}
  />
);

describe('CratesBookCard', () => {
  it('headlines the counted drawer and puts the supplier liability beneath it', () => {
    render(card());

    expect(screen.getByText('Crate cash')).toBeInTheDocument();
    expect(screen.getByText('14,400.00 ₴')).toBeInTheDocument();
    expect(screen.getByText('deposits for 123 crates — 14,760.00 ₴')).toBeInTheDocument();
  });

  it('uses the singular for exactly one crate', () => {
    render(card({ crateDeposits: '150.00', crateDepositUnits: 1 }));

    expect(screen.getByText('deposits for 1 crate — 150.00 ₴')).toBeInTheDocument();
  });

  it('says no deposits are held instead of printing «deposits for 0 crates»', () => {
    render(card({ crateCash: '0.00', crateDeposits: '0.00', crateDepositUnits: 0 }));

    expect(screen.getByText('no crate deposits held')).toBeInTheDocument();
    expect(screen.queryByText(/deposits for 0/)).toBeNull();
  });

  it('a drawer never counted says so instead of printing 0,00', () => {
    render(card({ crateCash: null }));

    expect(screen.getByText('not counted yet')).toBeInTheDocument();
    expect(screen.queryByText('14,400.00 ₴')).toBeNull();
  });

  it('prints the unexplained difference only when there is one', () => {
    const { rerender } = render(card());
    expect(screen.queryByText(/Discrepancy/)).toBeNull();

    rerender(card({ crateUnexplained: '-360.00' }));
    expect(screen.getByText('Discrepancy −360.00 ₴')).toBeInTheDocument();
  });

  it('prints the footnote explaining the crates book sits apart from the berry book', () => {
    render(card());

    expect(screen.getByText(/This money sits apart from the berry cash/)).toBeInTheDocument();
  });

  it('prints both books side by side, never their sum (R1)', () => {
    // 1,000.00 + 14,400.00 = 15,400.00 is the forbidden number.
    render(card());

    expect(screen.getByText('Two books: berries 1,000.00 ₴ · crates 14,400.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText(/15,400\.00/)).toBeNull();
  });

  it('with the drawer never counted, the two-books line falls back to the liability', () => {
    render(card({ crateCash: null }));

    expect(screen.getByText('Two books: berries 1,000.00 ₴ · crates 14,760.00 ₴')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(card({ crateUnexplained: '-360.00' }));
    await expectNoAxeViolations(container);
  });
});
