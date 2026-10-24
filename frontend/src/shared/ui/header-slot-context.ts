import { createContext, useContext } from 'react';

/** The bar's two places a page fills — see `./header-slot`. */
export type HeaderSlotName = 'scope' | 'title';

export interface HeaderSlots {
  nodes: Record<HeaderSlotName, HTMLElement | null>;
  claims: Record<HeaderSlotName, number>;
  setNode: (slot: HeaderSlotName, node: HTMLElement | null) => void;
  claim: (slot: HeaderSlotName, delta: 1 | -1) => void;
}

export const HeaderSlotsContext = createContext<HeaderSlots | null>(null);

/** Whether a page has filled this place — the shell's default steps aside if so. */
export function useHeaderSlotClaimed(slot: HeaderSlotName): boolean {
  return (useContext(HeaderSlotsContext)?.claims[slot] ?? 0) > 0;
}
