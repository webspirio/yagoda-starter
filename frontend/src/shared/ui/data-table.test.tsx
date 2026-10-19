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

it('sits in the card frame by default, and renders bare with frame={false}', () => {
  const { container, rerender } = render(
    <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />,
  );
  const frame = container.querySelector('[data-slot="data-table-frame"]');
  expect(frame).toHaveClass('bg-card', 'border-line2');
  expect(frame?.querySelector('table')).not.toBeNull();

  rerender(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} frame={false} />);
  expect(container.querySelector('[data-slot="data-table-frame"]')).toBeNull();
  expect(container.querySelector('table')).not.toBeNull();
});

const sortable: Column<Row>[] = [
  { id: 'name', header: 'Назва', sortable: true, cell: (r) => r.name },
  { id: 'qty', header: 'К-сть', sortable: true, align: 'right', cell: (r) => r.qty },
  { id: 'note', header: 'Примітка', cell: () => '' },
];

it('renders plain headers when no sort is given, even for sortable columns', () => {
  render(<DataTable columns={sortable} rows={rows} rowKey={(r) => r.id} />);
  expect(screen.queryByRole('button', { name: 'Назва' })).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Назва' })).not.toHaveAttribute('aria-sort');
});

it('makes sortable headers buttons, marks the active one, and reports the clicked key', async () => {
  const onSortChange = vi.fn();
  render(
    <DataTable
      columns={sortable}
      rows={rows}
      rowKey={(r) => r.id}
      sort={{ key: 'qty', order: 'desc' }}
      onSortChange={onSortChange}
    />,
  );
  expect(screen.getByRole('columnheader', { name: 'К-сть' })).toHaveAttribute('aria-sort', 'descending');
  expect(screen.getByRole('columnheader', { name: 'Назва' })).toHaveAttribute('aria-sort', 'none');
  expect(screen.getByRole('columnheader', { name: 'Примітка' })).not.toHaveAttribute('aria-sort');
  expect(screen.queryByRole('button', { name: 'Примітка' })).toBeNull();

  // An inactive sortable header still shows its arrow, so it reads as clickable.
  expect(screen.getByRole('button', { name: 'Назва' }).querySelector('svg')).not.toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Назва' }));
  expect(onSortChange).toHaveBeenCalledWith('name');
});

it('marks an ascending sort and stays axe-clean', async () => {
  const { container } = render(
    <DataTable
      columns={sortable}
      rows={rows}
      rowKey={(r) => r.id}
      sort={{ key: 'name', order: 'asc' }}
      onSortChange={() => {}}
    />,
  );
  expect(screen.getByRole('columnheader', { name: 'Назва' })).toHaveAttribute('aria-sort', 'ascending');
  await expectNoAxeViolations(container);
});

it('renders renderExpanded under its row in one full-width cell, and nothing for null', () => {
  render(
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      renderExpanded={(r) => (r.id === 'a' ? <span>Деталі малини</span> : null)}
    />,
  );
  const detail = screen.getByText('Деталі малини');
  const cell = detail.closest('td');
  expect(cell).toHaveAttribute('colspan', String(columns.length));
  // The detail row sits directly under its own row, before the next one.
  const tr = cell?.closest('tr');
  expect(tr?.previousElementSibling).toHaveTextContent('Малина');
  expect(tr?.nextElementSibling).toHaveTextContent('Полуниця');
  // Two data rows + one detail row, plus the header row.
  expect(screen.getAllByRole('row')).toHaveLength(4);
});

it('adds no extra rows when renderExpanded is not given', () => {
  render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
  expect(screen.getAllByRole('row')).toHaveLength(3);
});

it('limits onRowClick (and its pointer cursor) to rows rowClickable accepts', async () => {
  const onRowClick = vi.fn();
  render(
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={onRowClick}
      rowClickable={(r) => r.id === 'b'}
    />,
  );
  await userEvent.click(screen.getByText('Малина'));
  expect(onRowClick).not.toHaveBeenCalled();
  expect(screen.getByText('Малина').closest('tr')).not.toHaveClass('cursor-pointer');

  await userEvent.click(screen.getByText('Полуниця'));
  expect(onRowClick).toHaveBeenCalledWith(rows[1], 1);
  expect(screen.getByText('Полуниця').closest('tr')).toHaveClass('cursor-pointer');
});
