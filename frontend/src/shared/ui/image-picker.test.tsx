import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { ImagePicker } from './image-picker';

const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      const url = `blob:url-${++n}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revoked.push(url);
    }),
  });
});

afterEach(() => vi.unstubAllGlobals());

const file = () => new File(['x'], 'a.png', { type: 'image/png' });

describe('ImagePicker', () => {
  it('names the upload button so AT can announce it', () => {
    render(<ImagePicker value={null} onChange={vi.fn()} title="Photo" required />);
    expect(screen.getByRole('button', { name: 'Photo' })).toBeInTheDocument();
  });

  it('puts the id on the focusable button, not the hidden file input', () => {
    // A form that focuses the first invalid control by getElementById(name)
    // needs this: the file input is display:none, so focusing it would
    // silently do nothing.
    render(<ImagePicker value={null} onChange={vi.fn()} title="Photo" />);
    const target = document.getElementById('photo');
    expect(target?.tagName).toBe('BUTTON');
  });

  it('never revokes the URL the rendered <img> is using', () => {
    render(
      <StrictMode>
        <ImagePicker value={file()} onChange={vi.fn()} title="Photo" />
      </StrictMode>,
    );
    // Not screen.getByRole('img'): the preview <img> is intentionally
    // alt="" (decorative — the button already carries the name via
    // aria-label), which computes to role "presentation", not "img". A
    // plain DOM query sidesteps accessible-role semantics entirely, which
    // is correct here since this test is about object-URL lifecycle, not
    // the accessible name.
    const src = document.querySelector('img')?.getAttribute('src');
    expect(src).toBeTruthy();
    expect(revoked).not.toContain(src);
  });

  it('leaks no object URL under StrictMode', () => {
    const { unmount } = render(
      <StrictMode>
        <ImagePicker value={file()} onChange={vi.fn()} title="Photo" />
      </StrictMode>,
    );
    unmount();
    expect([...created].sort()).toEqual([...revoked].sort());
  });

  it('revokes the previous URL when the file changes', () => {
    const { rerender } = render(<ImagePicker value={file()} onChange={vi.fn()} title="Photo" />);
    const first = created[0];
    rerender(<ImagePicker value={file()} onChange={vi.fn()} title="Photo" />);
    expect(revoked).toContain(first);
  });

  it('announces a validation error', () => {
    render(<ImagePicker value={null} onChange={vi.fn()} title="Photo" error="profile.avatarError" />);
    const alert = screen.getByRole('alert');
    const button = screen.getByRole('button', { name: 'Photo' });
    expect(button).toHaveAttribute('aria-invalid', 'true');
    expect(button.getAttribute('aria-describedby')).toContain(alert.id);
  });
});
