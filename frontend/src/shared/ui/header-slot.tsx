import { useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HeaderSlotsContext, type HeaderSlotName, type HeaderSlots } from './header-slot-context';

/**
 * Places in the app's top bar that a PAGE fills (client, 24.10): `scope` is where the
 * owner picks the point the screen is about, `title` is the screen's own one-line header.
 * The shell owns the bar and marks the places (`HeaderSlotTarget`); a page renders
 * `<HeaderSlot slot="…">` anywhere in its tree and the content is portaled up there.
 *
 * The content stays a REACT child of the page — its state, its hooks, its handlers — and
 * only its DOM moves. With no shell around it (a page test, a page rendered bare) there is
 * nowhere to move it to, so it renders in place, exactly where the page wrote it.
 *
 * The shell asks `useHeaderSlotClaimed` (`./header-slot-context`) whether a page filled a
 * place, and shows its own default (the scope chip, the owner's working-point select) only
 * when none did.
 */
export function HeaderSlotsProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<HeaderSlots['nodes']>({ scope: null, title: null });
  const [claims, setClaims] = useState<HeaderSlots['claims']>({ scope: 0, title: 0 });

  const setNode = useCallback((slot: HeaderSlotName, node: HTMLElement | null) => {
    setNodes((prev) => (prev[slot] === node ? prev : { ...prev, [slot]: node }));
  }, []);
  const claim = useCallback((slot: HeaderSlotName, delta: 1 | -1) => {
    setClaims((prev) => ({ ...prev, [slot]: prev[slot] + delta }));
  }, []);

  const value = useMemo(() => ({ nodes, claims, setNode, claim }), [nodes, claims, setNode, claim]);
  return <HeaderSlotsContext.Provider value={value}>{children}</HeaderSlotsContext.Provider>;
}

/** The shell's mark for one place in the bar. */
export function HeaderSlotTarget({
  slot,
  className,
}: {
  slot: HeaderSlotName;
  className?: string;
}) {
  const slots = useContext(HeaderSlotsContext);
  const setNode = slots?.setNode;
  // Stable, so React does not detach and re-attach the node on every render.
  const ref = useCallback((node: HTMLDivElement | null) => setNode?.(slot, node), [setNode, slot]);
  return <div ref={ref} className={className} />;
}

/** A page's content for one place in the bar; in place when there is no bar. */
export function HeaderSlot({ slot, children }: { slot: HeaderSlotName; children: ReactNode }) {
  const slots = useContext(HeaderSlotsContext);
  const claim = slots?.claim;

  // Layout, not passive: the shell's default must be gone before the first paint, or it
  // flashes beside the page's own content.
  useLayoutEffect(() => {
    if (!claim) return;
    claim(slot, 1);
    return () => claim(slot, -1);
  }, [claim, slot]);

  if (!slots) return <>{children}</>;
  const node = slots.nodes[slot];
  return node ? createPortal(children, node) : null;
}
