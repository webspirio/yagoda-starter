import { describe, expect, it } from 'vitest';
import { validateImageFile, resolveUploadUrl, IMAGE_MAX_BYTES } from './image';

describe('validateImageFile', () => {
  it('rejects a non-image type', () => {
    expect(validateImageFile({ type: 'application/pdf', size: 10 })).toBe('type');
  });
  it('rejects an oversized file', () => {
    expect(validateImageFile({ type: 'image/png', size: IMAGE_MAX_BYTES + 1 })).toBe('size');
  });
  it('accepts a valid image', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 100 })).toBeNull();
  });
});

describe('resolveUploadUrl', () => {
  it('leaves absolute urls untouched', () => {
    expect(resolveUploadUrl('https://x/y.png')).toBe('https://x/y.png');
  });
  it('leaves blob urls untouched', () => {
    expect(resolveUploadUrl('blob:abc')).toBe('blob:abc');
  });
  it('resolves a /uploads path to end with the same path', () => {
    expect(resolveUploadUrl('/uploads/a.png')).toMatch(/\/uploads\/a\.png$/);
  });
});
