import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { ListPage } from './list-page';
import { type Column } from '@/shared/ui/data-table';

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [
  { id: 'name', header: 'Назва', cell: (r) => r.name },
  { id: 'qty', header: 'К-сть', align: 'right', cell: (_r, i) => i + 1 },
];

const rows: Row[] = [
  { id: 'a', name: 'Шипинки' },
  { id: 'b', name: 'Гайове' },
];

it('renders the title as an h1 plus the toolbar and stats nodes', () => {
  render(
    <ListPage
      title="Точки"
      stats={<span>Всього: 2</span>}
      toolbar={<button type="button">Додати</button>}
    />,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Точки' })).toBeInTheDocument();
  expect(screen.getByText('Всього: 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Додати' })).toBeInTheDocument();
});

it('renders the data table and fires onRowClick with the row and index', async () => {
  const onRowClick = vi.fn();
  render(
    <ListPage<Row>
      title="Точки"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={onRowClick}
    />,
  );
  expect(screen.getByText('Назва')).toBeInTheDocument();
  expect(screen.getByText('Шипинки')).toBeInTheDocument();

  await userEvent.click(screen.getByText('Шипинки'));
  expect(onRowClick).toHaveBeenCalledWith(rows[0], 0);
});

it('renders the empty node instead of the table when isEmpty', () => {
  render(
    <ListPage<Row>
      title="Точки"
      columns={columns}
      rows={rows}
      isEmpty
      empty={<span>Порожньо</span>}
    />,
  );
  expect(screen.getByText('Порожньо')).toBeInTheDocument();
  expect(screen.queryByText('Назва')).not.toBeInTheDocument();
  expect(screen.queryByText('Шипинки')).not.toBeInTheDocument();
});

it('has no axe violations', async () => {
  const { container } = render(
    <ListPage<Row> title="Точки" columns={columns} rows={rows} rowKey={(r) => r.id} />,
  );
  await expectNoAxeViolations(container);
});
