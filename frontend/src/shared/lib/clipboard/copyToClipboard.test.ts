import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyToClipboard } from './copyToClipboard';

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (document as { execCommand?: unknown }).execCommand;
    document.querySelectorAll('textarea').forEach((el) => el.remove());
  });

  it('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    await copyToClipboard('hello');

    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the Clipboard API is unavailable or rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    // jsdom doesn't implement execCommand at all, so it must be defined before it can be spied on.
    let capturedValue: string | undefined;
    const execCommand = vi.fn(() => {
      capturedValue = document.querySelector('textarea')?.value;
      return true;
    });
    document.execCommand = execCommand;

    await copyToClipboard('hello');

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(capturedValue).toBe('hello');
    // The scratch textarea must not leak into the DOM after copying.
    expect(document.querySelector('textarea')).toBeNull();
  });
});
