import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreatePermissionDto } from './dto/create-permission.dto.js';
import { PermissionQueryDto } from './dto/permission-query.dto.js';
import { UpdatePermissionDto } from './dto/update-permission.dto.js';
import { PermissionCode } from './permission-code.js';
import { PermissionService } from './permission.service.js';
import { Permissions } from './permissions.decorator.js';

/** 权限目录。按权限编码控制，不再额外要求管理员角色名。 */
@Controller('permissions')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  /** 新建权限。需要 system:permission:create。 */
  @Permissions(PermissionCode.SYSTEM_PERMISSION_CREATE)
  @Post()
  create(@Body() dto: CreatePermissionDto) {
    return this.permissionService.create(dto);
  }

  /** 权限列表。配置角色时也要能读到目录。 */
  @Permissions(PermissionCode.SYSTEM_PERMISSION, PermissionCode.SYSTEM_ROLE)
  @Get()
  findAll(@Query() query: PermissionQueryDto) {
    return this.permissionService.findAll(query);
  }

  /** 查询一条权限。 */
  @Permissions(PermissionCode.SYSTEM_PERMISSION)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.permissionService.findOne(id);
  }

  /** 修改权限。需要 system:permission:edit。 */
  @Permissions(PermissionCode.SYSTEM_PERMISSION_EDIT)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePermissionDto) {
    return this.permissionService.update(id, dto);
  }

  /** 软删除权限，并拆掉角色、用户上的关联。有子权限时不允许删。 */
  @Permissions(PermissionCode.SYSTEM_PERMISSION_DELETE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.permissionService.remove(id);
  }
}
