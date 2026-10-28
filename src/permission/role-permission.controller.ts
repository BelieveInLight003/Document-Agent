import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import {
  AssignPermissionsDto,
  ChangePermissionsDto,
} from './dto/assign-permissions.dto.js';
import { PermissionCode } from './permission-code.js';
import { Permissions } from './permissions.decorator.js';
import { RolePermissionService } from './role-permission.service.js';

/** 角色上的权限。查询只看这个角色，合并是追加，替换会清掉原来的。 */
@Controller('roles')
export class RolePermissionController {
  constructor(private readonly rolePermissions: RolePermissionService) {}

  /** 只查这个角色直接绑定的权限。 */
  @Permissions(PermissionCode.SYSTEM_ROLE)
  @Get(':id/permissions')
  list(@Param('id') id: string) {
    return this.rolePermissions.list(id);
  }

  /** 用传入列表整组替换。空数组表示清空。 */
  @Permissions(PermissionCode.SYSTEM_ROLE_EDIT)
  @Put(':id/permissions')
  replace(@Param('id') id: string, @Body() dto: AssignPermissionsDto) {
    return this.rolePermissions.replace(id, dto.permissionIds);
  }

  /** 在原有权限上追加，已有的保留。 */
  @Permissions(PermissionCode.SYSTEM_ROLE_EDIT)
  @Post(':id/permissions')
  merge(@Param('id') id: string, @Body() dto: ChangePermissionsDto) {
    return this.rolePermissions.merge(id, dto.permissionIds);
  }

  /** 从该角色上删掉指定权限。 */
  @Permissions(PermissionCode.SYSTEM_ROLE_EDIT)
  @Delete(':id/permissions')
  remove(@Param('id') id: string, @Body() dto: ChangePermissionsDto) {
    return this.rolePermissions.remove(id, dto.permissionIds);
  }
}
