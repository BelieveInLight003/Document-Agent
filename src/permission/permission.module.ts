import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../user/entities/role.entity.js';
import { UserRole } from '../user/entities/user-role.entity.js';
import { User } from '../user/entities/user.entity.js';
import { Permission } from './entities/permission.entity.js';
import { RolePermission } from './entities/role-permission.entity.js';
import { UserPermission } from './entities/user-permission.entity.js';
import { PermissionController } from './permission.controller.js';
import { PermissionService } from './permission.service.js';
import { RolePermissionController } from './role-permission.controller.js';
import { RolePermissionService } from './role-permission.service.js';
import { PermissionSeedService } from './permission-seed.service.js';
import { UserPermissionController } from './user-permission.controller.js';
import { UserPermissionService } from './user-permission.service.js';

/** 权限模块。目录、角色关联、用户关联分三个控制器，守卫用的合并结果从这里导出。 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Permission,
      RolePermission,
      UserPermission,
      User,
      Role,
      UserRole,
    ]),
  ],
  controllers: [
    PermissionController,
    RolePermissionController,
    UserPermissionController,
  ],
  providers: [
    PermissionService,
    PermissionSeedService,
    RolePermissionService,
    UserPermissionService,
  ],
  exports: [UserPermissionService, RolePermissionService],
})
export class PermissionModule {}
