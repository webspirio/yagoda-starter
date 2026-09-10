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

  it('keeps «Doesn\'t match» for a disputed transfer that is still unresolved', () => {
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

  it('has no axe violations', async () => {
    const { container } = render(<TransferStatusBadge status="disputed" />);
    await expectNoAxeViolations(container);
  });
});
