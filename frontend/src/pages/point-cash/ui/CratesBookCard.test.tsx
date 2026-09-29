import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import { CratesBookCard } from './CratesBookCard';

describe('CratesBookCard', () => {
  it('shows the crate-deposit figure and a plural caption for the unit count', () => {
    render(<CratesBookCard crateDeposits="1250.00" crateDepositUnits={3} berryCash="1000.00" />);

    expect(screen.getByText('Crate cash')).toBeInTheDocument();
    expect(screen.getByText('1,250.00 ₴')).toBeInTheDocument();
    expect(screen.getByText('deposits for 3 crates')).toBeInTheDocument();
  });

  it('uses the singular caption for exactly one crate', () => {
    render(<CratesBookCard crateDeposits="150.00" crateDepositUnits={1} berryCash="1000.00" />);

    expect(screen.getByText('deposits for 1 crate')).toBeInTheDocument();
  });

  it('says no deposits are held instead of printing «deposits for 0 crates»', () => {
    render(<CratesBookCard crateDeposits="0.00" crateDepositUnits={0} berryCash="1000.00" />);

    expect(screen.getByText('no crate deposits held')).toBeInTheDocument();
    expect(screen.queryByText(/deposits for 0/)).toBeNull();
  });

  it('prints the footnote explaining the crates book sits apart from the berry book', () => {
    render(<CratesBookCard crateDeposits="0.00" crateDepositUnits={0} berryCash="1000.00" />);

    expect(
      screen.getByText(/This money sits apart from the berry cash/),
    ).toBeInTheDocument();
  });

  it('prints both books side by side under a muted line, and never their sum (R1)', () => {
    // The client's «Правка» under the 20:50 story: berry cash and crate
    // deposits do not lie in one drawer, and `point-cash.service.ts`
    // (backend) already refuses to add the two books — this card must not
    // either. 1,000.00 + 250.00 = 1,250.00 is the forbidden number.
    render(<CratesBookCard crateDeposits="250.00" crateDepositUnits={2} berryCash="1000.00" />);

    expect(
      screen.getByText('Two books: berries 1,000.00 ₴ · crates 250.00 ₴'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/1,250\.00/)).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <CratesBookCard crateDeposits="250.00" crateDepositUnits={2} berryCash="1000.00" />,
    );
    await expectNoAxeViolations(container);
  });
});
