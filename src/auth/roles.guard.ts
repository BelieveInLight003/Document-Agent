import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * 全局角色守卫。接口用 @Roles() 标明允许的角色，当前用户拥有其中之一才放行。
 * 没写 @Roles() 时，登录即可访问。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { roles?: string[] };
    }>();
    if (!request.user) {
      throw new UnauthorizedException('未登录');
    }
    const roles = request.user.roles ?? [];
    const allowed = required.some((role) => roles.includes(role));
    if (!allowed) {
      throw new ForbiddenException('没有权限');
    }
    return true;
  }
}
