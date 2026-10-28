import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator.js';
import { PERMISSIONS_KEY } from './permissions.decorator.js';
import { UserPermissionService } from './user-permission.service.js';

/**
 * 全局权限守卫。接口用 @Permissions() 标明需要的权限编码。
 * 用户通过启用中的角色拿到的权限，和直接授予的权限，合并后拥有其中之一才放行。
 * 没写 @Permissions() 时，登录即可访问。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userPermissions: UserPermissionService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { id?: string };
    }>();
    if (!request.user?.id) {
      throw new UnauthorizedException('未登录');
    }
    const owned = await this.userPermissions.codesOf(request.user.id);
    const allowed = required.some((code) => owned.includes(code));
    if (!allowed) {
      throw new ForbiddenException('没有权限');
    }
    return true;
  }
}
