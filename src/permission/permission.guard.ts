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
    // @Public() 在类加载时用 SetMetadata 写上。这里不查库，只读方法、再读类上的标记。
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // 左边：接口要求的权限码，来自 @Permissions()。
    // 例如 @Permissions(PermissionCode.DOCUMENT_CREATE) 存的是 ['document:create']。
    // 方法上的标记盖过类上的。没写 @Permissions() 时 required 为空，登录即可访问。
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    // 用户 id 来自前一个 JwtAuthGuard。JwtStrategy 查库后把用户挂在 request.user。
    const request = context.switchToHttp().getRequest<{
      user?: { id?: string };
    }>();
    if (!request.user?.id) {
      throw new UnauthorizedException('未登录');
    }
    // 右边：这个用户实际拥有的权限码。按 id 查库，合并直接授权和启用角色带来的权限。
    // 停用或已删除的权限不会出现在 owned 里。
    const owned = await this.userPermissions.codesOf(request.user.id);
    // 要求的权限码里命中任意一个即通过。
    const allowed = required.some((code) => owned.includes(code));
    if (!allowed) {
      throw new ForbiddenException('没有权限');
    }
    return true;
  }
}
