import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Auth } from './decorators/auth.decorators';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './jwt.strategy';

/**
 * Both endpoints are far more attractive to a brute-forcer than the rest of
 * the API, so they carry a tighter limit than the global 100/min: 10 requests
 * per minute per IP, counted in Redis so the limit holds across replicas.
 */
@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /**
   * The token is a stateless JWT with no server-side session to destroy, so
   * logging out is still entirely a client-side discard — this endpoint
   * cannot revoke the token itself (see `users.is_active`'s doc comment and
   * the README's "no token revocation" note for why). It exists for
   * symmetry with register/login and to put the sign-out moment in the audit
   * log, which is why it requires a valid token rather than being a no-op.
   */
  @Post('logout')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.auth.logout(actor);
  }
}
