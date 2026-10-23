import * as React from 'react';
import { cmp } from '@/shared/lib/money';
import type { SortState } from './data-table';

/** An amount, compared exactly as a decimal string — never through a float. */
interface DecimalKey {
  decimal: string;
}

/** What a column sorts by. `null` is «no value» and sorts last in both directions. */
type SortKey = number | string | DecimalKey | null;

/** Per sortable column id, how to read a row's sort key. */
export type SortKeys<Row> = Record<string, (row: Row) => SortKey>;

export const decimalKey = (value: string | null): DecimalKey | null =>
  value == null ? null : { decimal: value };

const collator = new Intl.Collator('uk', { numeric: true, sensitivity: 'base' });

function compareKeys(a: Exclude<SortKey, null>, b: Exclude<SortKey, null>): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'object' && typeof b === 'object') return cmp(a.decimal, b.decimal);
  return collator.compare(String(a), String(b));
}

/**
 * Client-side sorting for a `DataTable` that holds its whole list — never for a
 * server-paged one, which would sort only the page it has. Feeds the table's
 * controlled `sort` + `onSortChange` (#253): a press on another column sorts it
 * ascending, a press on the current one flips it. There is always a sort — the
 * table shows its headers as buttons only while it is given one.
 */
export function useClientSort<Row>(rows: Row[], keys: SortKeys<Row>, initial: SortState) {
  const [sort, setSort] = React.useState<SortState>(initial);
  // A column the table dropped takes its sort with it, or no header would show the order.
  if (!keys[sort.key] && keys[initial.key]) setSort(initial);

  const onSortChange = (key: string) => {
    if (!keys[key]) return;
    setSort((cur) =>
      cur?.key === key
        ? { key, order: cur.order === 'asc' ? 'desc' : 'asc' }
        : { key, order: 'asc' },
    );
  };

  const read = keys[sort.key];
  const sorted = !read
    ? rows
    : rows
        .map((row, i) => ({ row, i, key: read(row) }))
        .sort((x, y) => {
          // Empty last whichever way the column runs: «—» is no value, not the smallest one.
          if (x.key == null || y.key == null) {
            return x.key == null ? (y.key == null ? x.i - y.i : 1) : -1;
          }
          const order = compareKeys(x.key, y.key);
          return (sort.order === 'asc' ? order : -order) || x.i - y.i;
        })
        .map((x) => x.row);

  return { rows: sorted, sort, onSortChange };
}
