import { SetMetadata } from '@nestjs/common';

/** 标记接口不需要登录。守卫读取这个标记后直接放行。 */
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
