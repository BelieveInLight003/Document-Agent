import { Body, Controller, Get, Post } from '@nestjs/common';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import { RolePermissionService } from '../permission/role-permission.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UserService } from './user.service.js';

/** 角色查询和新建。权限绑定走同一路径下的 permissions 接口。 */
@Controller('roles')
export class RoleController {
  constructor(
    private readonly userService: UserService,
    private readonly rolePermissions: RolePermissionService,
  ) {}

  @Permissions(PermissionCode.SYSTEM_ROLE, PermissionCode.SYSTEM_USER)
  @Get()
  findAll() {
    return this.userService.listRoles();
  }

  /** 新建角色，并按传入的权限列表完成绑定。 */
  @Permissions(PermissionCode.SYSTEM_ROLE_CREATE)
  @Post()
  async create(@Body() dto: CreateRoleDto) {
    const role = await this.userService.createRole(dto);
    const bound = await this.rolePermissions.replace(
      role.id,
      dto.permissionIds ?? [],
    );
    return {
      ...role,
      permissions: bound.permissions,
    };
  }
}
