import { BadRequestException } from '@nestjs/common';
import type { ImageKind } from './image-signature';

// sharp's CJS module.exports IS the factory (no `.default`, no `__esModule`), so
// with esModuleInterop off a default import calls an undefined `.default` at
// runtime: require() it. The type is the factory whichever declaration TS picks —
// tsc reads the `export =` .d.cts, ts-jest's resolver the ESM `export default` .d.mts.
export type SharpFactory = typeof import('sharp') extends { default: infer F } ? F : typeof import('sharp');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- sharp's CJS export cannot be default-imported without esModuleInterop, which this tsconfig does not set
const sharp: SharpFactory = require('sharp');

/**
 * Re-encode an uploaded image in its detected format with ALL metadata
 * stripped (EXIF/GPS, XMP, ICC) and EXIF orientation baked in. sharp drops
 * metadata by default (we never call withMetadata()); `.rotate()` with no args
 * auto-orients from EXIF FIRST so the visual is preserved after the strip. A
 * decompression bomb trips sharp's default `limitInputPixels` and throws → 400.
 */
export async function processImage(buffer: Buffer, kind: ImageKind): Promise<Buffer> {
  try {
    const pipeline = sharp(buffer).rotate();
    if (kind === 'jpeg') return await pipeline.jpeg().toBuffer();
    if (kind === 'png') return await pipeline.png().toBuffer();
    return await pipeline.webp().toBuffer();
  } catch {
    throw new BadRequestException('The image could not be processed');
  }
}
