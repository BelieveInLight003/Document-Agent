/** kh_permission.permission_type：1 菜单，2 按钮，3 接口。 */
export const PermissionType = {
  MENU: 1,
  BUTTON: 2,
  API: 3,
} as const;

export const PERMISSION_TYPES = Object.values(PermissionType);
