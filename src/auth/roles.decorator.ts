import { SetMetadata } from '@nestjs/common';

/** 标记接口允许哪些角色。不标记则任意已登录用户可访问。 */
export const ROLES_KEY = 'roles';

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
