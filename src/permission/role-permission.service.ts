import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Role } from '../user/entities/role.entity.js';
import { RolePermission } from './entities/role-permission.entity.js';
import { uniqueSnowflakeIds } from './permission-id.js';
import { PermissionService } from './permission.service.js';
import { permissionView } from './permission.view.js';

/** 角色和权限的关联：单独查询、整组替换、合并、删除。 */
@Injectable()
export class RolePermissionService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    private readonly permissionService: PermissionService,
    private readonly dataSource: DataSource,
  ) {}

  /** 只查这个角色直接绑定的权限。 */
  async list(roleId: string) {
    const role = await this.requireRole(roleId);
    const links = await this.rolePermissionRepository.find({
      where: { roleId: role.id },
    });
    const permissions = await this.permissionService.findLinked(
      links.map((link) => link.permissionId),
    );
    return {
      roleId: role.id.toString(),
      roleCode: role.roleCode,
      permissions: permissions.map((permission) => permissionView(permission)),
    };
  }

  /** 用传入的权限整组替换该角色原来的权限。空数组表示清空。 */
  async replace(roleId: string, permissionIds: string[]) {
    const role = await this.requireRole(roleId);
    const ids = uniqueSnowflakeIds(permissionIds, '权限');
    await this.permissionService.requireEnabled(ids);
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(RolePermission, { roleId: role.id });
      await this.insertLinks(manager, role.id, ids);
    });
    return this.list(roleId);
  }

  /** 在原有权限上追加，已有的保留。 */
  async merge(roleId: string, permissionIds: string[]) {
    const role = await this.requireRole(roleId);
    const ids = uniqueSnowflakeIds(permissionIds, '权限');
    await this.permissionService.requireEnabled(ids);
    const existing = await this.rolePermissionRepository.find({
      where: { roleId: role.id },
    });
    const owned = new Set(existing.map((link) => link.permissionId.toString()));
    const missing = ids.filter((id) => !owned.has(id.toString()));
    await this.dataSource.transaction(async (manager) => {
      await this.insertLinks(manager, role.id, missing);
    });
    return this.list(roleId);
  }

  async remove(roleId: string, permissionIds: string[]) {
    const role = await this.requireRole(roleId);
    const ids = uniqueSnowflakeIds(permissionIds, '权限');
    await this.rolePermissionRepository.delete({
      roleId: role.id,
      permissionId: In(ids),
    });
    return this.list(roleId);
  }

  private async requireRole(roleId: string) {
    const id = uniqueSnowflakeIds([roleId], '角色')[0];
    const role = await this.roleRepository.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException('角色不存在');
    }
    return role;
  }

  private async insertLinks(
    manager: DataSource['manager'],
    roleId: bigint,
    permissionIds: bigint[],
  ) {
    if (permissionIds.length === 0) {
      return;
    }
    await manager.save(
      permissionIds.map((permissionId) =>
        manager.create(RolePermission, { roleId, permissionId }),
      ),
    );
  }
}
