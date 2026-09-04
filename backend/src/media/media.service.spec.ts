import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { MediaService } from './media.service';
import { MediaFile } from './media-file.entity';
import { MediaPurpose } from './media.constants';
// sharp: CJS export= runtime under ESM-typed defs; see image-processing.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp: typeof import('sharp').default = require('sharp');

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
}

/** Minimal fake of the MediaFile repository — only create/save/delete are used. */
function fakeRepo() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    create: (x: Record<string, unknown>) => x,
    save: async (x: Record<string, unknown>) => {
      const row = { id: 'row-uuid', ...x };
      rows.push(row);
      return row;
    },
    delete: async () => {},
  };
}

describe('MediaService', () => {
  let dir: string;
  let repo: ReturnType<typeof fakeRepo>;
  let service: MediaService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'media-'));
    repo = fakeRepo();
    service = new MediaService(
      { dir, publicPrefix: '/uploads' },
      repo as unknown as Repository<MediaFile>,
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('stores a JPEG under avatars/<uuid>.jpg and returns id + prefixed url', async () => {
    const buf = await jpeg();
    const res = await service.store(
      { buffer: buf, size: buf.length },
      { purpose: MediaPurpose.Avatar, uploadedBy: null },
    );

    expect(res.id).toBe('row-uuid');
    expect(res.url).toMatch(/^\/uploads\/avatars\/[0-9a-f-]{36}\.jpg$/);
    const [name] = readdirSync(join(dir, 'avatars'));
    expect(`/uploads/avatars/${name}`).toBe(res.url);
    expect(existsSync(join(dir, res.url.slice('/uploads/'.length)))).toBe(true);
    expect(repo.rows).toHaveLength(1);
  });

  it('rejects a non-image with a friendly 400 (magic bytes)', async () => {
    const html = Buffer.from('<html><script>x</script></html>');
    await expect(
      service.store(
        { buffer: html, size: html.length },
        { purpose: MediaPurpose.Avatar, uploadedBy: null },
      ),
    ).rejects.toThrow('Only JPEG, PNG or WebP images are accepted');
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('rejects a missing file', async () => {
    await expect(
      service.store(undefined, { purpose: MediaPurpose.Avatar, uploadedBy: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes the written file when the metadata insert fails', async () => {
    const buf = await jpeg();
    repo.save = async () => {
      throw new Error('db down');
    };
    await expect(
      service.store({ buffer: buf, size: buf.length }, { purpose: MediaPurpose.Avatar, uploadedBy: null }),
    ).rejects.toThrow('db down');
    // The per-purpose subfolder itself is left behind (only the file is
    // rm'd), but it must be empty — no orphaned file survives the failure.
    expect(readdirSync(join(dir, 'avatars'))).toHaveLength(0);
  });

  describe('deleteByUrl', () => {
    it('removes a file served from our prefix', async () => {
      const buf = await jpeg();
      const { url } = await service.store(
        { buffer: buf, size: buf.length },
        { purpose: MediaPurpose.Avatar, uploadedBy: null },
      );
      const filePath = join(dir, url.slice('/uploads/'.length));
      expect(existsSync(filePath)).toBe(true);
      await service.deleteByUrl(url);
      expect(existsSync(filePath)).toBe(false);
    });

    it('ignores a URL outside our prefix', async () => {
      const buf = await jpeg();
      const { url } = await service.store(
        { buffer: buf, size: buf.length },
        { purpose: MediaPurpose.Avatar, uploadedBy: null },
      );
      const filePath = join(dir, url.slice('/uploads/'.length));
      await expect(service.deleteByUrl('https://cdn.example.com/x.png')).resolves.toBeUndefined();
      expect(existsSync(filePath)).toBe(true);
    });

    it('is idempotent when the file is already gone', async () => {
      await expect(service.deleteByUrl('/uploads/does-not-exist.png')).resolves.toBeUndefined();
    });

    it('refuses to escape via a traversal path', async () => {
      const sentinel = join(dir, '..', 'do-not-delete.txt');
      writeFileSync(sentinel, 'keep me');
      try {
        await service.deleteByUrl('/uploads/../do-not-delete.txt');
        expect(existsSync(sentinel)).toBe(true);
      } finally {
        rmSync(sentinel, { force: true });
      }
    });

    it('refuses an absolute-path name (resolves outside the uploads dir)', async () => {
      const sentinel = join(tmpdir(), 'media-absolute-sentinel.txt');
      writeFileSync(sentinel, 'keep me');
      try {
        await service.deleteByUrl(`/uploads/${sentinel}`);
        expect(existsSync(sentinel)).toBe(true);
      } finally {
        rmSync(sentinel, { force: true });
      }
    });
  });
});
