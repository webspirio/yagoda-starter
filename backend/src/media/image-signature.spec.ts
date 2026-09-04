import { sniffImage, IMAGE_EXTENSIONS } from './image-signature';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const webp = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'latin1'),
  Buffer.from('VP8 ', 'latin1'),
]);

describe('sniffImage (magic bytes — mimetype is never trusted)', () => {
  it('detects JPEG', () => expect(sniffImage(jpeg)).toBe('jpeg'));
  it('detects PNG', () => expect(sniffImage(png)).toBe('png'));
  it('detects WebP', () => expect(sniffImage(webp)).toBe('webp'));

  it('rejects other formats even when they are real images (e.g. GIF)', () => {
    expect(sniffImage(Buffer.from('GIF89a......', 'latin1'))).toBeNull();
  });

  it('rejects scripts/HTML masquerading as images', () => {
    expect(sniffImage(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.4 ...'))).toBeNull();
  });

  it('rejects truncated buffers shorter than the signature', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    // RIFF container that is NOT WebP (e.g. WAV).
    expect(
      sniffImage(
        Buffer.concat([
          Buffer.from('RIFF', 'latin1'),
          Buffer.from([0x24, 0x00, 0x00, 0x00]),
          Buffer.from('WAVE', 'latin1'),
        ]),
      ),
    ).toBeNull();
  });

  it('maps kinds to canonical extensions', () => {
    expect(IMAGE_EXTENSIONS).toEqual({ jpeg: 'jpg', png: 'png', webp: 'webp' });
  });
});
