import { Controller, INestApplication, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MEDIA_MAX_BYTES } from './media.constants';
import type { UploadedImage } from './media.service';

/** THIS IS THE GUARD ON THE `multer` OVERRIDE, and it is the only test in this repo
 *  that drives a real multipart request through `FileInterceptor`.
 *
 *  The root `overrides.multer` entry ships a multer version that
 *  `@nestjs/platform-express` never declared compatible with — it pins the exact string
 *  `2.2.0`. That pin is the whole reason the override exists (the pinned version carries
 *  four published advisories), and it is also the reason nothing upstream is testing this
 *  combination for us. Two behaviours are what `me.controller.ts` actually relies on, and
 *  a multer upgrade is exactly the kind of change that could break either one silently:
 *  a file arrives whole in memory, and `limits.fileSize` rejects an oversized body rather
 *  than truncating it. Both are asserted below against a real HTTP request.
 *
 *  If this ever goes red, do not widen it — drop the override and take the advisories,
 *  or move to a platform-express whose own pin is clean. */
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
