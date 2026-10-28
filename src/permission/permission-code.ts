/** 与 kh_permission.permission_code 里预置的编码一致。 */
export const PermissionCode = {
  DOCUMENT_CREATE: 'document:create',
  DOCUMENT_EDIT: 'document:edit',
  DOCUMENT_DELETE: 'document:delete',
  DOCUMENT_REVIEW: 'document:review',
  SEARCH: 'search',
  SYSTEM_USER: 'system:user',
  SYSTEM_ROLE: 'system:role',
  SYSTEM_TEAM: 'system:team',
  SYSTEM_PERMISSION: 'system:permission',
  SYSTEM_PERMISSION_CREATE: 'system:permission:create',
  SYSTEM_PERMISSION_EDIT: 'system:permission:edit',
  SYSTEM_PERMISSION_DELETE: 'system:permission:delete',
} as const;
