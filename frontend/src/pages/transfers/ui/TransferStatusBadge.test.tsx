import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import { TransferStatusBadge } from './TransferStatusBadge';

describe('TransferStatusBadge', () => {
  it('labels a sent transfer as in transit', () => {
    render(<TransferStatusBadge status="sent" />);
    expect(screen.getByText('In transit')).toBeInTheDocument();
  });

  it('labels an accepted transfer as accepted', () => {
    render(<TransferStatusBadge status="accepted" />);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });

  it('labels a disputed transfer with the client-facing phrase used elsewhere in the app', () => {
    render(<TransferStatusBadge status="disputed" />);
    expect(screen.getByText("Doesn't match")).toBeInTheDocument();
  });

  it("keeps «Doesn't match» for a disputed transfer that is still unresolved", () => {
    render(<TransferStatusBadge status="disputed" resolvedAt={null} />);
    expect(screen.getByText("Doesn't match")).toBeInTheDocument();
    expect(screen.queryByText('Resolved')).toBeNull();
  });

  it('switches to «Resolved» once a disputed transfer has been settled — status alone never changes', () => {
    render(<TransferStatusBadge status="disputed" resolvedAt="2026-09-10T09:00:00.000Z" />);
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.queryByText("Doesn't match")).toBeNull();
  });

  it('ignores resolvedAt for a status other than disputed', () => {
    render(<TransferStatusBadge status="accepted" resolvedAt="2026-09-10T09:00:00.000Z" />);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByText('Resolved')).toBeNull();
  });

  it('shows the count for two or more disputes', () => {
    render(<TransferStatusBadge status="disputed" count={3} />);
    expect(screen.getByText("Doesn't match (3)")).toBeInTheDocument();
  });

  it('keeps the plain label for a count below two', () => {
    render(<TransferStatusBadge status="disputed" count={1} />);
    expect(screen.getByText("Doesn't match")).toBeInTheDocument();
  });

  it('renders trailing children inside the badge', () => {
    render(
      <TransferStatusBadge status="disputed">
        <span data-testid="tail" />
      </TransferStatusBadge>,
    );
    expect(screen.getByText("Doesn't match")).toContainElement(screen.getByTestId('tail'));
  });

  it('has no axe violations', async () => {
    const { container } = render(<TransferStatusBadge status="disputed" />);
    await expectNoAxeViolations(container);
  });
  it('ignores count on a status other than disputed', () => {
    render(<TransferStatusBadge status="sent" count={3} />);
    expect(screen.getByText('In transit')).toBeInTheDocument();
    expect(screen.queryByText(/\(3\)/)).not.toBeInTheDocument();
  });
});
