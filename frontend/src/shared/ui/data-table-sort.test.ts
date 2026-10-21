import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { decimalKey, useClientSort, type SortKeys } from './data-table-sort';

interface Person {
  id: string;
  name: string;
  no: number;
  point: string | null;
  cash: string | null;
}
const people: Person[] = [
  { id: 'a', name: 'Оксана', no: 2, point: 'Шипинки', cash: '9.00' },
  { id: 'b', name: 'Ігор', no: 10, point: null, cash: null },
  { id: 'c', name: 'Богдан', no: 1, point: 'Гайове', cash: '10.00' },
];
const keys: SortKeys<Person> = {
  no: (p) => p.no,
  name: (p) => p.name,
  point: (p) => p.point,
  cash: (p) => decimalKey(p.cash),
};

const setup = () => renderHook(() => useClientSort(people, keys, { key: 'name', order: 'asc' }));
const ids = (rows: Person[]) => rows.map((p) => p.id);

describe('useClientSort (#250)', () => {
  it('starts at the initial sort', () => {
    const { result } = setup();
    expect(result.current.sort).toEqual({ key: 'name', order: 'asc' });
    expect(ids(result.current.rows)).toEqual(['c', 'b', 'a']);
  });

  it('sorts numbers as numbers, ascending then descending', () => {
    const { result } = setup();
    act(() => result.current.onSortChange('no'));
    expect(result.current.sort).toEqual({ key: 'no', order: 'asc' });
    expect(ids(result.current.rows)).toEqual(['c', 'a', 'b']); // 1, 2, 10 — not "1, 10, 2"
    act(() => result.current.onSortChange('no'));
    expect(result.current.sort).toEqual({ key: 'no', order: 'desc' });
    expect(ids(result.current.rows)).toEqual(['b', 'a', 'c']);
  });

  it('sorts text in Ukrainian alphabet order — «І» after «Б», before «О»', () => {
    const { result } = setup();
    act(() => result.current.onSortChange('no'));
    act(() => result.current.onSortChange('name'));
    expect(ids(result.current.rows)).toEqual(['c', 'b', 'a']);
  });

  it('compares decimal strings as amounts (9.00 < 10.00), unset last both ways', () => {
    const { result } = setup();
    act(() => result.current.onSortChange('cash'));
    expect(ids(result.current.rows)).toEqual(['a', 'c', 'b']);
    act(() => result.current.onSortChange('cash'));
    expect(ids(result.current.rows)).toEqual(['c', 'a', 'b']);
  });

  it('keeps empty values last in both directions', () => {
    const { result } = setup();
    act(() => result.current.onSortChange('point'));
    expect(ids(result.current.rows)).toEqual(['c', 'a', 'b']);
    act(() => result.current.onSortChange('point'));
    expect(ids(result.current.rows)).toEqual(['a', 'c', 'b']);
  });

  it('starts a newly pressed column ascending', () => {
    const { result } = setup();
    act(() => result.current.onSortChange('no'));
    act(() => result.current.onSortChange('no'));
    act(() => result.current.onSortChange('name'));
    expect(result.current.sort).toEqual({ key: 'name', order: 'asc' });
  });

  it('ignores a key it has no accessor for', () => {
    const { result } = setup();
    act(() => result.current.onSortChange('note'));
    expect(result.current.sort).toEqual({ key: 'name', order: 'asc' });
  });

  /** A column the table drops (#229: «Точка» once a point is picked) takes its sort with it. */
  it('goes back to the initial sort when the sorted column leaves', () => {
    const { result, rerender } = renderHook(
      ({ k }) => useClientSort(people, k, { key: 'name', order: 'asc' }),
      { initialProps: { k: keys } },
    );
    act(() => result.current.onSortChange('point'));

    rerender({ k: { no: keys.no, name: keys.name, cash: keys.cash } });
    expect(result.current.sort).toEqual({ key: 'name', order: 'asc' });
    expect(ids(result.current.rows)).toEqual(['c', 'b', 'a']);

    // …and stays there when the column comes back.
    rerender({ k: keys });
    expect(result.current.sort).toEqual({ key: 'name', order: 'asc' });
  });
});
