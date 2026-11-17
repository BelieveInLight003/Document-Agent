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
    // @Public() 在类加载时用 SetMetadata 写上。这里不查库，只读方法、再读类上的标记。
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // 左边：接口要求的角色，来自 @Roles()，例如 @Roles(RoleCode.ADMIN) 存的是 ['ROLE_ADMIN']。
    // 方法上的标记盖过类上的。没写 @Roles() 时 required 为空，登录即可访问。
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    // 右边：当前用户的角色。JwtAuthGuard 已经跑过，JwtStrategy 查库后把用户挂在 request.user。
    // roles 是启用中的角色编码，不是令牌里签发时的那一份。
    const request = context.switchToHttp().getRequest<{
      user?: { roles?: string[] };
    }>();
    if (!request.user) {
      throw new UnauthorizedException('未登录');
    }
    // @Roles 写编写的角色,取到
    const roles = request.user.roles ?? [];
    // 要求的角色里命中用户拥有的任意一个即通过。
    const allowed = required.some((role) => roles.includes(role));
    if (!allowed) {
      throw new ForbiddenException('没有权限');
    }
    return true;
  }
}
