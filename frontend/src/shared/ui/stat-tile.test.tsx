import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../test-axe';
import { StatTile, StatGrid } from './stat-tile';

it('renders value and label at the default size', () => {
  render(<StatTile value="7" label="Attended" />);
  expect(screen.getByText('7')).toHaveClass('text-[26px]', 'font-extrabold', 'text-brand');
  expect(screen.getByText('Attended')).toHaveClass('text-xs', 'text-muted-foreground');
});

it('scales value and label at the compact size', () => {
  render(<StatTile value="7" label="Months" size="compact" />);
  expect(screen.getByText('7')).toHaveClass('text-2xl');
  expect(screen.getByText('Months')).toHaveClass('text-[11px]', 'font-semibold', 'text-center');
});

it('applies labelClassName to the label span', () => {
  render(<StatTile value="7" label="X" labelClassName="text-center" />);
  expect(screen.getByText('X')).toHaveClass('text-center', 'text-xs');
});

it('StatGrid maps columns to a statically declared grid class', () => {
  const { rerender } = render(
    <StatGrid columns={2}>
      <span>x</span>
    </StatGrid>,
  );
  expect(screen.getByText('x').parentElement).toHaveClass(
    'grid',
    'grid-cols-2',
    'divide-x',
    'divide-border',
    'rounded-2xl',
    'border',
    'border-border',
    'bg-card',
  );
  rerender(
    <StatGrid columns={3}>
      <span>x</span>
    </StatGrid>,
  );
  expect(screen.getByText('x').parentElement).toHaveClass('grid-cols-3');
  expect(screen.getByText('x').parentElement).not.toHaveClass('grid-cols-2');
});

// --- onClick / button form ---------------------------------------------------

it('stays a div with no onClick', () => {
  render(<StatTile value={3} label="відвідано" />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('відвідано').closest('[data-slot="stat-tile"]')).not.toBeNull();
});

it('renders a 44px button when given an onClick', () => {
  render(<StatTile value={3} label="відвідано" onClick={vi.fn()} ariaLabel="відвідано: 3" />);
  expect(screen.getByRole('button', { name: 'відвідано: 3' })).toHaveClass('min-h-[44px]');
});

it('calls onClick on tap', async () => {
  const onClick = vi.fn();
  render(<StatTile value={3} label="відвідано" onClick={onClick} ariaLabel="відвідано: 3" />);
  await userEvent.click(screen.getByRole('button'));
  expect(onClick).toHaveBeenCalledTimes(1);
});

it('keeps the press highlight off the grid divider', () => {
  render(
    <StatGrid columns={2}>
      <StatTile value={1} label="a" onClick={vi.fn()} ariaLabel="a: 1" />
    </StatGrid>,
  );
  // the highlight lives on an inner wrapper, never on the element that is the grid cell
  expect(screen.getByRole('button')).not.toHaveClass('active:bg-muted');
  expect(screen.getByRole('button').querySelector('.active\\:bg-muted')).not.toBeNull();
});

it('keeps the press highlight inset on every tile in an adjacent-tile grid', () => {
  // Two pressable tiles side by side — the divider-avoidance rule has to hold
  // for each cell independently, not just for a lone tile in isolation.
  render(
    <StatGrid columns={2}>
      <StatTile value={1} label="a" onClick={vi.fn()} ariaLabel="a: 1" />
      <StatTile value={2} label="b" onClick={vi.fn()} ariaLabel="b: 2" />
    </StatGrid>,
  );
  for (const button of screen.getAllByRole('button')) {
    expect(button).not.toHaveClass('active:bg-muted');
    expect(button.querySelector('.active\\:bg-muted')).not.toBeNull();
  }
});

it('has no axe violations in either mode', async () => {
  const { container } = render(
    <StatGrid columns={2}>
      <StatTile value={1} label="відвідано" onClick={vi.fn()} ariaLabel="відвідано: 1" />
      <StatTile value={2} label="явка" />
    </StatGrid>,
  );
  await expectNoAxeViolations(container);
});

it('gives a grid of all-button tiles distinct accessible names', () => {
  render(
    <StatGrid columns={2}>
      <StatTile value={9} label="відвідано" onClick={vi.fn()} ariaLabel="відвідано: 9" />
      <StatTile value={82} label="дисципліна" onClick={vi.fn()} ariaLabel="дисципліна: 82%" />
    </StatGrid>,
  );
  expect(screen.getByRole('button', { name: 'відвідано: 9' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'дисципліна: 82%' })).toBeInTheDocument();
});

// --- className placement (review follow-up: was undocumented/untested) -----
//
// `className` styles the TILE. In div mode the div IS the tile, so it lands
// there — unchanged from before. In button mode the button is a tap-target
// shell around the tile (the inset content box), not the tile itself, so
// `className` follows the content box, never the outer `<button>`. Both
// directions are pinned here so the contract can't silently drift either way.

it('className placement — targets the div in div mode', () => {
  render(<StatTile value="7" label="X" className="custom-marker" />);
  const tile = screen.getByText('X').closest('[data-slot="stat-tile"]');
  expect(tile).toHaveClass('custom-marker');
});

it('className placement — targets the inner content box, not the button, in button mode', () => {
  render(
    <StatTile value="7" label="X" onClick={vi.fn()} ariaLabel="X: 7" className="custom-marker" />,
  );
  const button = screen.getByRole('button');
  expect(button).not.toHaveClass('custom-marker');
  expect(button.querySelector('.custom-marker')).not.toBeNull();
});

// Compile-time guard: onClick and ariaLabel must travel together. This isn't
// exercised by vitest (esbuild strips types without checking them) — it's
// caught by `tsc -p tsconfig.app.json --noEmit`, the project's real type gate.
function typeGuardOnlyNeverCalled() {
  // @ts-expect-error onClick without ariaLabel must not compile
  return <StatTile value={1} label="x" onClick={() => {}} />;
}
void typeGuardOnlyNeverCalled;
