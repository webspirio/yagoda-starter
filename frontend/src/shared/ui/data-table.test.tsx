import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../test-axe';
import { DataTable, type Column } from './data-table';

interface Row {
  id: string;
  name: string;
  qty: number;
}
const columns: Column<Row>[] = [
  { id: 'name', header: 'Назва', cell: (r) => r.name },
  { id: 'qty', header: 'К-сть', align: 'right', cell: (r) => r.qty },
];
const rows: Row[] = [
  { id: 'a', name: 'Малина', qty: 3 },
  { id: 'b', name: 'Полуниця', qty: 5 },
];

it('renders headers and cells', () => {
  render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
  expect(screen.getByText('Назва')).toBeInTheDocument();
  expect(screen.getByText('Малина')).toBeInTheDocument();
  expect(screen.getByText('5')).toBeInTheDocument();
});

it('fires onRowClick with the row and index', async () => {
  const onRowClick = vi.fn();
  render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
  await userEvent.click(screen.getByText('Малина'));
  expect(onRowClick).toHaveBeenCalledWith(rows[0], 0);
});

it('shows the empty node when there are no rows', () => {
  render(<DataTable columns={columns} rows={[]} empty={<span>Порожньо</span>} />);
  expect(screen.getByText('Порожньо')).toBeInTheDocument();
});

it('has no axe violations', async () => {
  const { container } = render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
  await expectNoAxeViolations(container);
});
