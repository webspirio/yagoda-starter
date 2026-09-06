import { diffFields } from './diff-fields';

describe('diffFields', () => {
  const before = { name: 'Малина', kind: 'reception', is_active: true };

  it('returns null when nothing in the key set moved', () => {
    expect(diffFields(before, { ...before }, ['name', 'kind', 'is_active'])).toBeNull();
  });

  it('returns only the keys that moved', () => {
    const after = { ...before, name: 'Полуниця' };
    expect(diffFields(before, after, ['name', 'kind', 'is_active'])).toEqual({
      changed: ['name'],
      before: { name: 'Малина' },
      after: { name: 'Полуниця' },
    });
  });

  it('ignores changes outside the key set', () => {
    const after = { ...before, kind: 'base' };
    expect(diffFields(before, after, ['name'])).toBeNull();
  });

  // Both operands are annotated because `diffFields<T>(before: T, after: T, …)`
  // infers T from the FIRST argument: written as bare literals, T would be
  // `{ target: null }` and `{ target: undefined }` would not be assignable.
  it('treats null and undefined as different values', () => {
    type Nullable = { target: string | null | undefined };
    const before: Nullable = { target: null };
    const after: Nullable = { target: undefined };
    expect(diffFields(before, after, ['target'])).toEqual({
      changed: ['target'],
      before: { target: null },
      after: { target: undefined },
    });
  });

  it('reports several moved keys at once', () => {
    const after = { name: 'Полуниця', kind: 'base', is_active: true };
    expect(diffFields(before, after, ['name', 'kind', 'is_active'])?.changed).toEqual(['name', 'kind']);
  });
});
