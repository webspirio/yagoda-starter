import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { authConfig } from '../config/auth.config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [authConfig.KEY],
      useFactory: (auth: ConfigType<typeof authConfig>) => ({
        secret: auth.jwtSecret,
        // authConfig types jwtExpiresIn as `string` (it comes straight off
        // JWT_EXPIRES_IN); jsonwebtoken's SignOptions narrows it to `ms`'s
        // branded StringValue template-literal type. The cast is to that
        // specific type, not `any` — an invalid value (e.g. "banana") still
        // fails loudly at runtime inside jsonwebtoken.
        signOptions: { algorithm: 'HS256', expiresIn: auth.jwtExpiresIn as StringValue },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
