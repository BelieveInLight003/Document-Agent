import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service.js';
import type { UserProfile } from '../user/user.service.js';

type AccessPayload = {
  sub?: string;
  type?: string;
};

/**
 * 从 Authorization: Bearer 取出 accessToken，用 JWT_ACCESS_SECRET 验签。
 * 通过后按用户 id 查库，把当前用户交给后续守卫和接口。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessPayload): Promise<UserProfile> {
    if (
      payload.type !== 'access' ||
      !payload.sub ||
      !/^\d+$/.test(payload.sub)
    ) {
      throw new UnauthorizedException('未登录');
    }
    return this.authService.me(payload.sub);
  }
}
