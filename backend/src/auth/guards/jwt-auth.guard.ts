import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';

/** Authentication guard used by @Auth(). Plain passport-jwt — there is no dev
 *  bypass; a seeded dev account (see the SeedDevAdmin migration) is the local
 *  shortcut instead. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // The constructor is not decoration for its own sake. AuthGuard('jwt') marks its
  // AuthModuleOptions parameter @Optional(), but Nest 12 no longer inherits that
  // optional metadata onto a subclass that declares no constructor of its own — it
  // reads the parent's paramtypes and then demands the dependency, so every one of
  // the 32 feature modules that spells @Auth() failed to instantiate this guard with
  // "can't resolve dependencies of the JwtAuthGuard (?)". Nothing provides
  // AuthModuleOptions here on purpose: bare PassportModule is @Module({}) and only
  // PassportModule.register() supplies it, so re-declaring the parameter as optional
  // is what restores the Nest 11 behaviour without making AuthModule global.
  constructor(@Optional() @Inject(AuthModuleOptions) options?: AuthModuleOptions) {
    super(options);
  }
}
