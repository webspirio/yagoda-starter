import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { authConfig } from '../config/auth.config';

export interface AuthenticatedUser {
  sub: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(authConfig.KEY)
    auth: ConfigType<typeof authConfig>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: auth.jwtSecret,
      algorithms: ['HS256'],
    });
  }

  validate(payload: AuthenticatedUser): AuthenticatedUser {
    return {
      sub: payload.sub,
      username: payload.username,
      display_name: payload.display_name,
      avatar_url: payload.avatar_url,
    };
  }
}
