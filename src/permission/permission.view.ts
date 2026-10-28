import type { Permission } from './entities/permission.entity.js';

/** 权限对外返回的字段。id 用十进制字符串，避免雪花被 Number 截断。 */
export type PermissionView = {
  id: string;
  parentId: string;
  permissionName: string;
  permissionCode: string;
  permissionType: number;
  menuUrl: string | null;
  apiUrl: string | null;
  method: string | null;
  icon: string | null;
  sort: number;
  status: number;
};

export function permissionView(permission: Permission): PermissionView {
  return {
    id: permission.id.toString(),
    parentId: permission.parentId.toString(),
    permissionName: permission.permissionName,
    permissionCode: permission.permissionCode,
    permissionType: permission.permissionType,
    menuUrl: permission.menuUrl,
    apiUrl: permission.apiUrl,
    method: permission.method,
    icon: permission.icon,
    sort: permission.sort,
    status: permission.status,
  };
}
