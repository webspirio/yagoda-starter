import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getStoredPoint, storePoint } from './index';

const UUID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('point preference', () => {
  it('remembers a point and reads it back', () => {
    storePoint(UUID);
    expect(getStoredPoint()).toBe(UUID);
  });

  it('is empty before anything is stored', () => {
    expect(getStoredPoint()).toBeNull();
  });

  it('forgets the point when given null', () => {
    storePoint(UUID);
    storePoint(null);
    expect(getStoredPoint()).toBeNull();
  });

  /** The server validates `collection_point_id` as a uuid; a hand-edited value
   *  must not travel from storage into a request. */
  it('refuses to store anything that is not a uuid', () => {
    storePoint('not-a-uuid');
    expect(getStoredPoint()).toBeNull();
  });

  it('ignores a junk value already in storage', () => {
    localStorage.setItem('web-starter:point', 'garbage');
    expect(getStoredPoint()).toBeNull();
  });

  /**
   * A private window or blocked site data must degrade to «nothing
   * remembered», never to a crash on a money screen.
   */
  it('survives storage being unavailable, in both directions', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(getStoredPoint()).toBeNull();
    expect(() => storePoint(UUID)).not.toThrow();
  });
});
