import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReceiptOpener } from './useReceiptOpener';

describe('useReceiptOpener', () => {
  it('starts closed with no receipt', () => {
    const { result } = renderHook(() => useReceiptOpener());
    expect(result.current).toMatchObject({ receiptId: null, open: false, startWithVoid: false });
  });

  it('opens plainly by default and straight into the void on request', () => {
    const { result } = renderHook(() => useReceiptOpener());

    act(() => result.current.openReceipt('i1', { void: true }));
    expect(result.current).toMatchObject({ receiptId: 'i1', open: true, startWithVoid: true });

    // A later plain open must not inherit the void flag.
    act(() => result.current.openReceipt('i2'));
    expect(result.current).toMatchObject({ receiptId: 'i2', open: true, startWithVoid: false });
  });

  it('close keeps the id (a stable dialog key); clear drops it', () => {
    const { result } = renderHook(() => useReceiptOpener());

    act(() => result.current.openReceipt('i1'));
    act(() => result.current.close());
    expect(result.current).toMatchObject({ receiptId: 'i1', open: false });

    act(() => result.current.openReceipt('i1'));
    act(() => result.current.clear());
    expect(result.current).toMatchObject({ receiptId: null, open: false });
  });
});
