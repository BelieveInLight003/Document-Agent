import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { RoleCode } from '../user/role-code.js';
import {
  AssignPermissionsDto,
  ChangePermissionsDto,
} from './dto/assign-permissions.dto.js';
import { PermissionCode } from './permission-code.js';
import { Permissions } from './permissions.decorator.js';
import { UserPermissionService } from './user-permission.service.js';

/**
 * 用户上的权限。
 * /permissions 只查直接授权，/permissions/merged 把角色权限并进来。
 */
@Controller('users')
@Roles(RoleCode.ADMIN)
@Permissions(PermissionCode.SYSTEM_USER)
export class UserPermissionController {
  constructor(private readonly userPermissions: UserPermissionService) {}

  /** 角色权限和直接权限合并后的结果。 */
  @Get(':id/permissions/merged')
  listMerged(@Param('id') id: string) {
    return this.userPermissions.listMerged(id);
  }

  /** 只查直接授给这个用户的权限。 */
  @Get(':id/permissions')
  list(@Param('id') id: string) {
    return this.userPermissions.list(id);
  }

  /** 用传入列表整组替换直接权限。空数组表示清空。 */
  @Put(':id/permissions')
  replace(@Param('id') id: string, @Body() dto: AssignPermissionsDto) {
    return this.userPermissions.replace(id, dto.permissionIds);
  }

  /** 在用户已有的直接权限上追加。 */
  @Post(':id/permissions')
  merge(@Param('id') id: string, @Body() dto: ChangePermissionsDto) {
    return this.userPermissions.merge(id, dto.permissionIds);
  }

  /** 删掉用户的若干直接权限，不影响角色带来的权限。 */
  @Delete(':id/permissions')
  remove(@Param('id') id: string, @Body() dto: ChangePermissionsDto) {
    return this.userPermissions.remove(id, dto.permissionIds);
  }
}
