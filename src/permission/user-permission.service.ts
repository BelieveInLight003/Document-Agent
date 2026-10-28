import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Role } from '../user/entities/role.entity.js';
import { UserRole } from '../user/entities/user-role.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserStatus } from '../user/user-status.js';
import { Permission } from './entities/permission.entity.js';
import { RolePermission } from './entities/role-permission.entity.js';
import { UserPermission } from './entities/user-permission.entity.js';
import { uniqueSnowflakeIds } from './permission-id.js';
import { PermissionService } from './permission.service.js';
import { permissionView, type PermissionView } from './permission.view.js';

type MergedPermission = PermissionView & {
  direct: boolean;
  roles: { id: string; roleCode: string; roleName: string }[];
};

/**
 * 用户权限。直接授权和角色授权分开查，合并结果给守卫和联合查询用。
 */
@Injectable()
export class UserPermissionService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserPermission)
    private readonly userPermissionRepository: Repository<UserPermission>,
    private readonly permissionService: PermissionService,
    private readonly dataSource: DataSource,
  ) {}

  /** 守卫使用。角色权限和直接权限取并集，只保留启用中的权限和角色。 */
  async codesOf(userId: string) {
    if (!/^\d+$/.test(userId)) {
      return [];
    }
    const merged = await this.mergeOf(BigInt(userId));
    return merged.map((item) => item.permissionCode);
  }

  /** 只查直接授给这个用户的权限，不含角色带来的。 */
  async list(userId: string) {
    const user = await this.requireUser(userId);
    const links = await this.userPermissionRepository.find({
      where: { userId: user.id },
    });
    const permissions = await this.permissionService.findLinked(
      links.map((link) => link.permissionId),
    );
    return {
      userId: user.id.toString(),
      permissions: permissions.map((permission) => permissionView(permission)),
    };
  }

  /** 角色权限和直接权限合并。同一条权限可以同时来自角色和用户。 */
  async listMerged(userId: string) {
    const user = await this.requireUser(userId);
    return {
      userId: user.id.toString(),
      permissions: await this.mergeOf(user.id),
    };
  }

  async replace(userId: string, permissionIds: string[]) {
    const user = await this.requireUser(userId);
    const ids = uniqueSnowflakeIds(permissionIds, '权限');
    await this.permissionService.requireEnabled(ids);
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(UserPermission, { userId: user.id });
      await this.insertLinks(manager, user.id, ids);
    });
    return this.list(userId);
  }

  async merge(userId: string, permissionIds: string[]) {
    const user = await this.requireUser(userId);
    const ids = uniqueSnowflakeIds(permissionIds, '权限');
    await this.permissionService.requireEnabled(ids);
    const existing = await this.userPermissionRepository.find({
      where: { userId: user.id },
    });
    const owned = new Set(existing.map((link) => link.permissionId.toString()));
    const missing = ids.filter((id) => !owned.has(id.toString()));
    await this.dataSource.transaction(async (manager) => {
      await this.insertLinks(manager, user.id, missing);
    });
    return this.list(userId);
  }

  async remove(userId: string, permissionIds: string[]) {
    const user = await this.requireUser(userId);
    const ids = uniqueSnowflakeIds(permissionIds, '权限');
    await this.userPermissionRepository.delete({
      userId: user.id,
      permissionId: In(ids),
    });
    return this.list(userId);
  }

  private async mergeOf(userId: bigint): Promise<MergedPermission[]> {
    const directLinks = await this.userPermissionRepository.find({
      where: { userId },
    });
    const userRoles = await this.userRoleRepository.find({ where: { userId } });
    const roles = userRoles.length
      ? await this.roleRepository.find({
          where: {
            id: In(userRoles.map((link) => link.roleId)),
            status: UserStatus.ENABLED,
          },
        })
      : [];
    const roleIds = roles.map((role) => role.id);
    const roleLinks = roleIds.length
      ? await this.rolePermissionRepository.find({
          where: { roleId: In(roleIds) },
        })
      : [];
    const permissionIds = [
      ...directLinks.map((link) => link.permissionId),
      ...roleLinks.map((link) => link.permissionId),
    ];
    const uniqueIds = [
      ...new Map(permissionIds.map((id) => [id.toString(), id])).values(),
    ];
    const permissions = uniqueIds.length
      ? await this.permissionRepository.find({
          where: {
            id: In(uniqueIds),
            deleted: false,
            status: UserStatus.ENABLED,
          },
          order: { sort: 'ASC', id: 'ASC' },
        })
      : [];
    const directIds = new Set(
      directLinks.map((link) => link.permissionId.toString()),
    );
    const rolesByPermission = new Map<string, MergedPermission['roles']>();
    const roleById = new Map(roles.map((role) => [role.id.toString(), role]));
    for (const link of roleLinks) {
      const role = roleById.get(link.roleId.toString());
      if (!role) {
        continue;
      }
      const key = link.permissionId.toString();
      const list = rolesByPermission.get(key) ?? [];
      list.push({
        id: role.id.toString(),
        roleCode: role.roleCode,
        roleName: role.roleName,
      });
      rolesByPermission.set(key, list);
    }
    return permissions.map((permission) => ({
      ...permissionView(permission),
      direct: directIds.has(permission.id.toString()),
      roles: rolesByPermission.get(permission.id.toString()) ?? [],
    }));
  }

  private async requireUser(userId: string) {
    const id = uniqueSnowflakeIds([userId], '用户')[0];
    const user = await this.userRepository.findOne({
      where: { id, deleted: false },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  private async insertLinks(
    manager: DataSource['manager'],
    userId: bigint,
    permissionIds: bigint[],
  ) {
    if (permissionIds.length === 0) {
      return;
    }
    await manager.save(
      permissionIds.map((permissionId) =>
        manager.create(UserPermission, { userId, permissionId }),
      ),
    );
  }
}
