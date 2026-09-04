import { randomUUID } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { uploadsConfig } from '../config/uploads.config';
import { MediaFile } from './media-file.entity';
import { MediaPurpose, MEDIA_SUBDIR } from './media.constants';
import { sniffImage, IMAGE_EXTENSIONS } from './image-signature';
import { processImage } from './image-processing';

/** Uploaded-file shape we consume (multer memory storage). */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

/**
 * Stores and deletes uploaded images. Validation is magic-bytes only
 * (`sniffImage`) — mimetype/filename are attacker-controlled and ignored. The
 * buffer is re-encoded via `processImage` to strip EXIF/GPS. The stored name is
 * a random uuid + the extension of the DETECTED type, under a per-purpose
 * subfolder (see `MEDIA_SUBDIR`) — no user input reaches the path. The 10 MB
 * cap is enforced upstream by the FileInterceptor. Every store writes a
 * `media_files` row; deleteByUrl removes the file AND the row.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(uploadsConfig.KEY)
    private readonly uploads: ConfigType<typeof uploadsConfig>,
    @InjectRepository(MediaFile)
    private readonly repo: Repository<MediaFile>,
  ) {}

  async store(
    file: UploadedImage | undefined,
    meta: { purpose: MediaPurpose; uploadedBy: string | null },
  ): Promise<{ id: string; url: string }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('file is required');
    }
    const kind = sniffImage(file.buffer);
    if (!kind) {
      throw new BadRequestException('Only JPEG, PNG or WebP images are accepted');
    }
    const processed = await processImage(file.buffer, kind);

    // Group files by purpose in a subfolder (see MEDIA_SUBDIR) rather than one
    // flat dir. The subfolder is part of the storage_key and the public URL,
    // so deleteByUrl can reverse it.
    const storageKey = `${MEDIA_SUBDIR[meta.purpose]}/${randomUUID()}.${IMAGE_EXTENSIONS[kind]}`;
    const filePath = join(this.uploads.dir, storageKey);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, processed);
    const url = `${this.uploads.publicPrefix}/${storageKey}`;

    try {
      const saved = await this.repo.save(
        this.repo.create({
          storage_key: storageKey,
          url,
          kind,
          size_bytes: processed.length,
          purpose: meta.purpose,
          uploaded_by: meta.uploadedBy,
        }),
      );
      return { id: saved.id, url };
    } catch (err) {
      // Don't leave an orphaned file with no metadata row (the future cleanup
      // cron sweeps rows) — remove it before surfacing the failure.
      await rm(filePath, { force: true });
      throw err;
    }
  }

  /**
   * Remove a stored image by its public URL. Idempotent + scoped: URLs not
   * directly under our prefix — external URLs, or a name with a backslash /
   * traversal segment — are ignored, so this can never touch anything outside
   * the uploads dir. The name is expected to be a single `<subdir>/<file>`
   * segment (see `MEDIA_SUBDIR`), so a bare `/` is no longer rejected. Drops
   * the metadata row too (a missing row is not an error; uploads predating
   * `media_files` simply have none).
   */
  async deleteByUrl(url: string): Promise<void> {
    const prefix = `${this.uploads.publicPrefix}/`;
    if (!url.startsWith(prefix)) return;
    const name = url.slice(prefix.length);
    if (!name || name.includes('\\') || name.includes('..')) return;
    const base = resolve(this.uploads.dir);
    const target = resolve(base, name);
    // Defence in depth beyond the `..`/backslash checks: the resolved path must
    // stay strictly inside the uploads dir (also rejects absolute-path names).
    // This permits the single `<subdir>/<file>` segment store() now produces.
    if (target !== base && !target.startsWith(base + sep)) return;
    await rm(target, { force: true });
    await this.repo.delete({ url });
  }
}
