import { BadRequestException } from '@nestjs/common';
import { processImage } from './image-processing';
// See image-processing.ts for why sharp is required this way, not default-imported.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp: typeof import('sharp').default = require('sharp');

async function jpegWithGpsExif(): Promise<Buffer> {
  // A tiny red JPEG carrying an EXIF GPS tag.
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .withExif({ IFD0: { Copyright: 'x' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 0/1 0/1' } })
    .jpeg()
    .toBuffer();
}

describe('processImage', () => {
  it('strips EXIF/GPS metadata from a JPEG', async () => {
    const input = await jpegWithGpsExif();
    expect((await sharp(input).metadata()).exif).toBeDefined(); // sanity: input has EXIF

    const out = await processImage(input, 'jpeg');

    expect((await sharp(out).metadata()).exif).toBeUndefined();
  });

  it('re-encodes each kind to the same format', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const out = await processImage(png, 'png');
    expect((await sharp(out).metadata()).format).toBe('png');
  });

  it('rejects a non-decodable buffer with a 400', async () => {
    await expect(processImage(Buffer.from('not an image'), 'jpeg')).rejects.toBeInstanceOf(BadRequestException);
  });
});
