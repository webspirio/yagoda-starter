import { describe, it, expect } from 'vitest';
import { keepUuids } from './keepUuids';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('keepUuids', () => {
  it('keeps null as null, so an absent param still means "use the default"', () => {
    expect(keepUuids(null)).toBeNull();
  });

  it('keeps a well-formed id', () => {
    expect(keepUuids([ID])).toEqual([ID]);
  });

  it('accepts an id in upper case', () => {
    expect(keepUuids([ID.toUpperCase()])).toEqual([ID.toUpperCase()]);
  });

  /*
   * The reason this exists. These filters reach the backend as
   * `@IsUUID` with `each: true`, so ONE malformed id in a shared link turns the
   * whole list into a 400 -- an error page instead of a list, from a value the
   * user never typed into the UI.
   */
  it.each(['garbage', '', '3f2504e0-4f89-41d3-9a0c', ID + 'x', '../etc/passwd'])(
    'drops %o',
    (bad) => {
      expect(keepUuids([bad, ID])).toEqual([ID]);
    },
  );
});
