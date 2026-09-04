import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Authentication guard used by @Auth(). Plain passport-jwt — there is no dev
 *  bypass; a seeded dev account (see the SeedDevAdmin migration) is the local
 *  shortcut instead. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
