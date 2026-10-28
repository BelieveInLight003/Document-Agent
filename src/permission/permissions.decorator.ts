import { SetMetadata } from '@nestjs/common';

/** 标记接口需要的权限编码。不标记则登录即可访问。拥有其中之一即可。 */
export const PERMISSIONS_KEY = 'permissions';

export const Permissions = (...codes: string[]) =>
  SetMetadata(PERMISSIONS_KEY, codes);
