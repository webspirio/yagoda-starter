import { it, expect } from 'vitest';
import uk from './locales/uk.json';
import ukCore from 'virtual:uk-core';
import ukOwner from 'virtual:uk-owner';
import { OWNER_NAMESPACES } from './owner-namespaces';

it('splits uk.json into two halves that add up to it exactly', () => {
  expect(Object.keys(ukOwner).sort()).toEqual([...OWNER_NAMESPACES].sort());
  expect({ ...ukCore, ...ukOwner }).toEqual(uk);
  for (const ns of OWNER_NAMESPACES) expect(ukCore).not.toHaveProperty(ns);
});
