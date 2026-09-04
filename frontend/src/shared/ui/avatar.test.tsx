import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar, AvatarImage, AvatarFallback } from './avatar';

// Radix preloads via `new Image()` and only commits the real <img> once that
// preloader fires `load`. jsdom never fires it, so without this shim the <img>
// never mounts and its class can't be asserted. Preserve the native src
// reflection and additionally resolve every assignment as a successful load.
//
// Dispatching a synthetic `load` event alone is not enough in this repo:
// Radix's loading-status check (`image.complete ? image.naturalWidth > 0 ? ...`)
// reads jsdom's native `complete`/`naturalWidth` getters, which only flip once
// jsdom's optional `canvas` native dependency decodes the image data — that
// package isn't installed here, so `complete` stays `false` forever and the
// <img> never commits even after `load` fires. Stub `complete`/`naturalWidth`
// too, flipped by the same fake load, so the status check resolves to "loaded".
let originalSrc: PropertyDescriptor | undefined;
let originalComplete: PropertyDescriptor | undefined;
let originalNaturalWidth: PropertyDescriptor | undefined;
beforeAll(() => {
  originalSrc = Object.getOwnPropertyDescriptor(window.Image.prototype, 'src');
  originalComplete = Object.getOwnPropertyDescriptor(window.Image.prototype, 'complete');
  originalNaturalWidth = Object.getOwnPropertyDescriptor(window.Image.prototype, 'naturalWidth');
  Object.defineProperty(window.Image.prototype, 'complete', {
    configurable: true,
    get() {
      return Boolean((this as { __fakeLoaded?: boolean }).__fakeLoaded);
    },
  });
  Object.defineProperty(window.Image.prototype, 'naturalWidth', {
    configurable: true,
    get() {
      return (this as { __fakeLoaded?: boolean }).__fakeLoaded ? 1 : 0;
    },
  });
  Object.defineProperty(window.Image.prototype, 'src', {
    configurable: true,
    get() {
      return originalSrc?.get?.call(this);
    },
    set(value: string) {
      originalSrc?.set?.call(this, value);
      queueMicrotask(() => {
        (this as { __fakeLoaded?: boolean }).__fakeLoaded = true;
        this.dispatchEvent(new Event('load'));
      });
    },
  });
});
afterAll(() => {
  if (originalSrc) Object.defineProperty(window.Image.prototype, 'src', originalSrc);
  if (originalComplete) Object.defineProperty(window.Image.prototype, 'complete', originalComplete);
  if (originalNaturalWidth) {
    Object.defineProperty(window.Image.prototype, 'naturalWidth', originalNaturalWidth);
  }
});

describe('AvatarImage', () => {
  it('renders the photo with object-cover so non-square images are not stretched', async () => {
    render(
      <Avatar>
        <AvatarImage src="/uploads/face.jpg" alt="Ада" />
        <AvatarFallback>АК</AvatarFallback>
      </Avatar>,
    );
    const img = await screen.findByRole('img', { name: 'Ада' });
    expect(img).toHaveClass('object-cover');
  });
});
