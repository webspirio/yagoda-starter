import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

describe('sorting (#250)', () => {
  interface Person {
    id: string;
    name: string;
    no: number;
    point: string | null;
  }
  const people: Person[] = [
    { id: 'a', name: 'Оксана', no: 2, point: 'Шипинки' },
    { id: 'b', name: 'Ігор', no: 10, point: null },
    { id: 'c', name: 'Богдан', no: 1, point: 'Гайове' },
  ];
  const sortable: Column<Person>[] = [
    { id: 'no', header: '№', cell: (p) => p.no, sortValue: (p) => p.no },
    { id: 'name', header: "Ім'я", cell: (p) => p.name, sortValue: (p) => p.name },
    { id: 'point', header: 'Точка', cell: (p) => p.point ?? '—', sortValue: (p) => p.point },
    { id: 'note', header: 'Примітка', cell: () => '' },
  ];
  const names = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[1].textContent);
  const renderTable = () =>
    render(<DataTable columns={sortable} rows={people} rowKey={(p) => p.id} />);

  it('keeps the given order until a header is pressed', () => {
    renderTable();
    expect(names()).toEqual(['Оксана', 'Ігор', 'Богдан']);
    expect(screen.getByRole('columnheader', { name: /№/ })).toHaveAttribute('aria-sort', 'none');
  });

  it('sorts numbers as numbers, ascending then descending', async () => {
    renderTable();
    const header = screen.getByRole('button', { name: /№/ });
    await userEvent.click(header);
    expect(names()).toEqual(['Богдан', 'Оксана', 'Ігор']); // 1, 2, 10 — not "1, 10, 2"
    expect(screen.getByRole('columnheader', { name: /№/ })).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(header);
    expect(names()).toEqual(['Ігор', 'Оксана', 'Богдан']);
    expect(screen.getByRole('columnheader', { name: /№/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('sorts text in Ukrainian alphabet order — «І» after «Б», before «О»', async () => {
    renderTable();
    await userEvent.click(screen.getByRole('button', { name: "Ім'я" }));
    expect(names()).toEqual(['Богдан', 'Ігор', 'Оксана']);
  });

  it('keeps empty values last in both directions', async () => {
    renderTable();
    const header = screen.getByRole('button', { name: 'Точка' });
    await userEvent.click(header);
    expect(names()).toEqual(['Богдан', 'Оксана', 'Ігор']);
    await userEvent.click(header);
    expect(names()).toEqual(['Оксана', 'Богдан', 'Ігор']);
  });

  it('starts a newly pressed column ascending', async () => {
    renderTable();
    await userEvent.click(screen.getByRole('button', { name: /№/ }));
    await userEvent.click(screen.getByRole('button', { name: /№/ }));
    await userEvent.click(screen.getByRole('button', { name: "Ім'я" }));
    expect(names()).toEqual(['Богдан', 'Ігор', 'Оксана']);
    expect(screen.getByRole('columnheader', { name: /№/ })).toHaveAttribute('aria-sort', 'none');
  });

  it('leaves a column without sortValue as a plain header', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: 'Примітка' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Примітка' })).not.toHaveAttribute('aria-sort');
  });

  it('has no axe violations with sortable headers', async () => {
    const { container } = renderTable();
    await expectNoAxeViolations(container);
  });
});
