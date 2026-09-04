import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

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
   * logging out is entirely a client-side discard. The endpoint exists so the
   * frontend has one obvious thing to call, and so a consuming project that
   * adds token revocation has the seam already wired.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(): void {}
}
