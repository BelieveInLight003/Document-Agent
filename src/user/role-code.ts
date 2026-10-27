/** 与 kh_role.role_code 一致。新注册用户绑定普通用户。 */
export const RoleCode = {
  ADMIN: 'ROLE_ADMIN',
  REVIEWER: 'ROLE_REVIEWER',
  USER: 'ROLE_USER',
} as const;

export const ROLE_CODES = Object.values(RoleCode);
