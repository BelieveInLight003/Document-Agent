import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { UserProfile } from '../user/user.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/**
 * 全局令牌守卫。带 @Public() 的接口直接放行，其余接口必须带有效的 accessToken。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser = UserProfile>(err: unknown, user: TUser): TUser {
    if (err instanceof UnauthorizedException) {
      throw err;
    }
    if (err || !user) {
      throw new UnauthorizedException('未登录');
    }
    return user;
  }
}
