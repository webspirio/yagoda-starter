import { BadRequestException } from '@nestjs/common';
import type { ImageKind } from './image-signature';

// sharp ships ESM-style type defs (`export default`) over a CJS runtime whose
// module.exports IS the factory (no `.default`, no `__esModule`). With this
// project's esModuleInterop off, a default import emits an undefined `.default`
// call at runtime and import-equals binds the non-callable namespace type. Bind
// the runtime factory via require, typed as sharp's default export.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- sharp's CJS export cannot be default-imported without esModuleInterop, which this tsconfig does not set
const sharp: typeof import('sharp').default = require('sharp');

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
