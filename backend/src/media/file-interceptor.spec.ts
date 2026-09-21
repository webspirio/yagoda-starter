import { Controller, INestApplication, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MEDIA_MAX_BYTES } from './media.constants';
import type { UploadedImage } from './media.service';

/** THE ONLY TEST IN THIS REPO THAT DRIVES A REAL MULTIPART REQUEST THROUGH FileInterceptor.
 *
 *  It was written to guard a root `overrides.multer` entry that forced a patched multer past
 *  `@nestjs/platform-express@11`'s exact `2.2.0` pin, which carried four published
 *  advisories. That override is gone: platform-express 12 depends on multer 2.4.0 directly,
 *  so the pin it worked around no longer exists.
 *
 *  The test stays, and the reason it stays is the reason it was worth writing. Nothing else
 *  here exercises the interceptor — media.service.spec.ts consumes the uploaded-file SHAPE
 *  and never the upload — so before this file, a change to the upload seam could only be
 *  caught in production. That seam now spans a major version of Nest AND of Express, which
 *  is more movement under it, not less.
 *
 *  Two behaviours, both of which me.controller.ts relies on and neither of which is ours:
 *  the body arrives whole in memory, and `limits.fileSize` REJECTS an oversized upload
 *  rather than silently truncating it. Verified as a discriminator: raising the limit makes
 *  the 413 assertion fail. */
@Controller('probe')
class ProbeController {
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEDIA_MAX_BYTES } }))
  upload(@UploadedFile() file: UploadedImage) {
    return { size: file.size, length: file.buffer.length, first: file.buffer[0], last: file.buffer[file.buffer.length - 1] };
  }
}

describe('FileInterceptor over the overridden multer', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('delivers the whole body as a buffer', async () => {
    const body = Buffer.alloc(64 * 1024, 7);
    const res = await request(app.getHttpServer())
      .post('/probe')
      .attach('file', body, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body).toEqual({ size: body.length, length: body.length, first: 7, last: 7 });
  });

  it('rejects a body over limits.fileSize instead of truncating it', async () => {
    await request(app.getHttpServer())
      .post('/probe')
      .attach('file', Buffer.alloc(MEDIA_MAX_BYTES + 1, 7), {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(413);
  });
});
