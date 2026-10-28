import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { UserStatus } from '../user/user-status.js';
import { CreatePermissionDto } from './dto/create-permission.dto.js';
import { PermissionQueryDto } from './dto/permission-query.dto.js';
import { UpdatePermissionDto } from './dto/update-permission.dto.js';
import { Permission } from './entities/permission.entity.js';
import { RolePermission } from './entities/role-permission.entity.js';
import { UserPermission } from './entities/user-permission.entity.js';
import { parseSnowflakeId } from './permission-id.js';
import { permissionView } from './permission.view.js';

/** 权限目录的增删改查。角色和用户上的关联交给各自的服务。 */
@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreatePermissionDto) {
    const permissionCode = dto.permissionCode.trim();
    await this.ensureCodeAvailable(permissionCode);
    const parentId = await this.resolveParent(dto.parentId);
    const saved = await this.permissionRepository.save(
      this.permissionRepository.create({
        parentId,
        permissionName: dto.permissionName.trim(),
        permissionCode,
        permissionType: dto.permissionType,
        menuUrl: this.emptyToNull(dto.menuUrl),
        apiUrl: this.emptyToNull(dto.apiUrl),
        method: this.emptyToNull(dto.method),
        icon: this.emptyToNull(dto.icon),
        sort: dto.sort ?? 0,
        status: dto.status ?? UserStatus.ENABLED,
        deleted: false,
      }),
    );
    return permissionView(saved);
  }

  async findAll(query: PermissionQueryDto) {
    const permissions = await this.permissionRepository.find({
      where: {
        deleted: false,
        ...(query.parentId !== undefined
          ? { parentId: parseSnowflakeId(query.parentId, '父权限') }
          : {}),
        ...(query.permissionCode
          ? { permissionCode: query.permissionCode.trim() }
          : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
      },
      order: { sort: 'ASC', id: 'ASC' },
    });
    return permissions.map((permission) => permissionView(permission));
  }

  async findOne(id: string) {
    return permissionView(await this.requireActive(id));
  }

  async update(id: string, dto: UpdatePermissionDto) {
    const permission = await this.requireActive(id);
    if (dto.permissionCode !== undefined) {
      const permissionCode = dto.permissionCode.trim();
      await this.ensureCodeAvailable(permissionCode, permission.id);
      permission.permissionCode = permissionCode;
    }
    if (dto.parentId !== undefined) {
      permission.parentId = await this.resolveParent(
        dto.parentId,
        permission.id,
      );
    }
    if (dto.permissionName !== undefined) {
      permission.permissionName = dto.permissionName.trim();
    }
    if (dto.permissionType !== undefined) {
      permission.permissionType = dto.permissionType;
    }
    if (dto.menuUrl !== undefined) {
      permission.menuUrl = this.emptyToNull(dto.menuUrl);
    }
    if (dto.apiUrl !== undefined) {
      permission.apiUrl = this.emptyToNull(dto.apiUrl);
    }
    if (dto.method !== undefined) {
      permission.method = this.emptyToNull(dto.method);
    }
    if (dto.icon !== undefined) {
      permission.icon = this.emptyToNull(dto.icon);
    }
    if (dto.sort !== undefined) {
      permission.sort = dto.sort;
    }
    if (dto.status !== undefined) {
      permission.status = dto.status;
    }
    await this.permissionRepository.save(permission);
    return permissionView(permission);
  }

  /** 软删除，并拆掉角色、用户上指向它的关联。有子权限时先要求删掉子级。 */
  async remove(id: string) {
    const permission = await this.requireActive(id);
    const child = await this.permissionRepository.findOne({
      where: { parentId: permission.id, deleted: false },
    });
    if (child) {
      throw new BadRequestException('请先删除子权限');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(RolePermission, { permissionId: permission.id });
      await manager.delete(UserPermission, { permissionId: permission.id });
      permission.deleted = true;
      await manager.save(permission);
    });
    return { id: permission.id.toString(), deleted: true };
  }

  /** 查询关联时带出未删除的权限，禁用的也返回，方便管理员核对。 */
  findLinked(ids: bigint[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.permissionRepository.find({
      where: { id: In(ids), deleted: false },
      order: { sort: 'ASC', id: 'ASC' },
    });
  }

  /** 关联角色或用户前，确认这些权限都存在且启用。 */
  async requireEnabled(ids: bigint[]) {
    if (ids.length === 0) {
      return [];
    }
    const permissions = await this.permissionRepository.find({
      where: {
        id: In(ids),
        deleted: false,
        status: UserStatus.ENABLED,
      },
    });
    if (permissions.length !== ids.length) {
      throw new BadRequestException('权限不存在或已禁用');
    }
    return permissions;
  }

  private async requireActive(id: string) {
    const permissionId = parseSnowflakeId(id, '权限');
    const permission = await this.permissionRepository.findOne({
      where: { id: permissionId, deleted: false },
    });
    if (!permission) {
      throw new NotFoundException('权限不存在');
    }
    return permission;
  }

  private async resolveParent(parentId: string | undefined, selfId?: bigint) {
    const parent = parseSnowflakeId(parentId ?? '0', '父权限');
    if (parent === 0n) {
      return parent;
    }
    if (selfId && parent === selfId) {
      throw new BadRequestException('父权限不能是自己');
    }
    const seen = new Set<string>();
    let current = parent;
    while (current !== 0n) {
      const key = current.toString();
      if (selfId && current === selfId) {
        throw new BadRequestException('父权限不能是自己的子权限');
      }
      if (seen.has(key)) {
        throw new BadRequestException('父权限形成了循环');
      }
      seen.add(key);
      const node = await this.permissionRepository.findOne({
        where: { id: current, deleted: false },
      });
      if (!node) {
        throw new NotFoundException('父权限不存在');
      }
      current = node.parentId;
    }
    return parent;
  }

  private async ensureCodeAvailable(permissionCode: string, exceptId?: bigint) {
    const existing = await this.permissionRepository.findOne({
      where: { permissionCode },
    });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('权限编码已存在');
    }
  }

  private emptyToNull(value?: string | null) {
    const text = value?.trim();
    return text ? text : null;
  }
}
