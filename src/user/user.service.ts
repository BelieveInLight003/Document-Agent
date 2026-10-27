import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { DataSource, EntityManager, In, Like, Repository } from 'typeorm';
import { AssignRolesDto } from './dto/assign-roles.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserQueryDto } from './dto/user-query.dto.js';
import { Role } from './entities/role.entity.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';
import { RoleCode } from './role-code.js';
import { UserStatus } from './user-status.js';

export type UserProfile = {
  id: string;
  username: string;
  email: string | null;
  realName: string | null;
  avatar: string | null;
  status: number;
  lastLoginAt: Date | null;
  roles: string[];
};

/**
 * 用户和角色的存储。登录发令牌仍在 AuthService，用户资料和角色绑定都从这里走。
 */
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
    private readonly dataSource: DataSource,
  ) {}

  /** 按用户名查未删除用户，含密码哈希，只给登录核对用。 */
  findByUsername(username: string) {
    return this.userRepository.findOne({
      where: { username: username.trim(), deleted: false },
    });
  }

  /** 按 id 查未删除且启用的用户。刷新令牌和当前用户资料用。 */
  findActiveById(id: string) {
    if (!/^\d+$/.test(id)) {
      return null;
    }
    return this.userRepository.findOne({
      where: {
        id: BigInt(id),
        deleted: false,
        status: UserStatus.ENABLED,
      },
    });
  }

  async toProfile(user: User): Promise<UserProfile> {
    return this.profileFrom(user, await this.roleCodesOf(user.id));
  }

  async touchLastLogin(user: User) {
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);
  }

  /**
   * 新建用户并绑定角色。不传角色时绑定普通用户。
   * 注册和管理员创建都走这里。
   */
  async create(dto: CreateUserDto): Promise<UserProfile> {
    const username = dto.username.trim();
    await this.ensureUsernameAvailable(username);
    const roleCodes = dto.roleCodes?.length ? dto.roleCodes : [RoleCode.USER];
    const password = await bcrypt.hash(dto.password, 10);
    const saved = await this.dataSource.transaction(async (manager) => {
      const user = await manager.save(
        manager.create(User, {
          username,
          password,
          email: this.emptyToNull(dto.email),
          realName: this.emptyToNull(dto.realName),
          avatar: this.emptyToNull(dto.avatar),
          status: dto.status ?? UserStatus.ENABLED,
          lastLoginAt: null,
          deleted: false,
        }),
      );
      await this.replaceRoles(user, roleCodes, manager);
      return user;
    });
    return this.toProfile(saved);
  }

  /** 分页查询未删除用户，可按用户名和状态筛选。 */
  async findAll(query: UserQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const username = query.username?.trim();
    const [users, total] = await this.userRepository.findAndCount({
      where: {
        deleted: false,
        ...(username
          ? { username: Like(`%${this.escapeLike(username)}%`) }
          : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      list: await this.profilesOf(users),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string) {
    return this.toProfile(await this.requireUser(id));
  }

  /** 管理员修改用户。传入 roleCodes 时整组替换原来的角色。 */
  async update(id: string, dto: UpdateUserDto) {
    const user = await this.requireUser(id);
    await this.applyAccount(user, dto);
    await this.dataSource.transaction(async (manager) => {
      await manager.save(user);
      if (dto.roleCodes) {
        await this.replaceRoles(user, dto.roleCodes, manager);
      }
    });
    return this.toProfile(user);
  }

  /** 当前用户改邮箱、姓名、头像和密码，不能改角色和状态。 */
  async updateProfile(id: string, dto: UpdateProfileDto) {
    const user = await this.findActiveById(id);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    if (dto.password) {
      if (!dto.oldPassword) {
        throw new BadRequestException('请填写原密码');
      }
      const matched = await bcrypt.compare(dto.oldPassword, user.password);
      if (!matched) {
        throw new BadRequestException('原密码错误');
      }
      user.password = await bcrypt.hash(dto.password, 10);
    }
    if (dto.email !== undefined) {
      user.email = this.emptyToNull(dto.email);
    }
    if (dto.realName !== undefined) {
      user.realName = this.emptyToNull(dto.realName);
    }
    if (dto.avatar !== undefined) {
      user.avatar = this.emptyToNull(dto.avatar);
    }
    await this.userRepository.save(user);
    return this.toProfile(user);
  }

  /** 软删除。保留行，避免角色关联外键被拆掉；登录不再查到这个用户。 */
  async remove(id: string, operatorId?: string) {
    const user = await this.requireUser(id);
    if (operatorId && user.id.toString() === operatorId) {
      throw new BadRequestException('不能删除当前登录用户');
    }
    user.deleted = true;
    await this.userRepository.save(user);
    return { id: user.id.toString(), deleted: true };
  }

  async assignRoles(id: string, roleCodes: AssignRolesDto['roleCodes']) {
    const user = await this.requireUser(id);
    await this.replaceRoles(user, roleCodes);
    return this.toProfile(user);
  }

  /** 启用中的角色，给管理端分配角色时选用。 */
  async listRoles() {
    const roles = await this.roleRepository.find({
      where: { status: UserStatus.ENABLED },
      order: { id: 'ASC' },
    });
    return roles.map((role) => ({
      id: role.id.toString(),
      roleName: role.roleName,
      roleCode: role.roleCode,
      description: role.description,
    }));
  }

  /** 某个启用角色下、账号仍启用的用户。审批员列表用这个。 */
  async listByRoleCode(roleCode: string) {
    const role = await this.roleRepository.findOne({
      where: { roleCode, status: UserStatus.ENABLED },
    });
    if (!role) {
      return [];
    }
    const links = await this.userRoleRepository.find({
      where: { roleId: role.id },
    });
    if (links.length === 0) {
      return [];
    }
    const users = await this.userRepository.find({
      where: {
        id: In(links.map((link) => link.userId)),
        deleted: false,
        status: UserStatus.ENABLED,
      },
      order: { username: 'ASC' },
    });
    return users.map((user) => ({
      id: user.id.toString(),
      username: user.username,
      realName: user.realName,
    }));
  }

  private async applyAccount(user: User, dto: UpdateUserDto) {
    if (dto.username !== undefined) {
      const username = dto.username.trim();
      await this.ensureUsernameAvailable(username, user.id);
      user.username = username;
    }
    if (dto.email !== undefined) {
      user.email = this.emptyToNull(dto.email);
    }
    if (dto.realName !== undefined) {
      user.realName = this.emptyToNull(dto.realName);
    }
    if (dto.avatar !== undefined) {
      user.avatar = this.emptyToNull(dto.avatar);
    }
    if (dto.status !== undefined) {
      user.status = dto.status;
    }
    if (dto.password) {
      user.password = await bcrypt.hash(dto.password, 10);
    }
  }

  private async ensureUsernameAvailable(username: string, exceptId?: bigint) {
    const existing = await this.userRepository.findOne({
      where: { username, deleted: false },
    });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('用户名已存在');
    }
  }

  private async requireUser(id: string) {
    if (!/^\d+$/.test(id)) {
      throw new NotFoundException('用户不存在');
    }
    const user = await this.userRepository.findOne({
      where: { id: BigInt(id), deleted: false },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  /**
   * 用一组角色编码替换该用户现有绑定。
   * 传入事务 manager 时和用户写入一起提交。
   */
  private async replaceRoles(
    user: User,
    roleCodes: string[],
    manager?: EntityManager,
  ) {
    const codes = [...new Set(roleCodes)];
    const roles = await this.roleRepository.find({
      where: { roleCode: In(codes), status: UserStatus.ENABLED },
    });
    if (roles.length !== codes.length) {
      throw new BadRequestException('角色不存在或已禁用');
    }
    const write = async (tx: EntityManager) => {
      await tx.delete(UserRole, { userId: user.id });
      await tx.save(
        codes.map((code) => {
          const role = roles.find((item) => item.roleCode === code);
          if (!role) {
            throw new BadRequestException('角色不存在或已禁用');
          }
          return tx.create(UserRole, {
            userId: user.id,
            roleId: role.id,
          });
        }),
      );
    };
    if (manager) {
      await write(manager);
      return;
    }
    await this.dataSource.transaction(write);
  }

  private async roleCodesOf(userId: bigint) {
    const grouped = await this.roleCodesByUsers([userId]);
    return grouped.get(userId.toString()) ?? [];
  }

  private async roleCodesByUsers(userIds: bigint[]) {
    const grouped = new Map<string, string[]>();
    if (userIds.length === 0) {
      return grouped;
    }
    const links = await this.userRoleRepository.find({
      where: { userId: In(userIds) },
    });
    if (links.length === 0) {
      return grouped;
    }
    const roles = await this.roleRepository.find({
      where: {
        id: In(links.map((link) => link.roleId)),
        status: UserStatus.ENABLED,
      },
    });
    const codeById = new Map(
      roles.map((role) => [role.id.toString(), role.roleCode]),
    );
    for (const link of links) {
      const code = codeById.get(link.roleId.toString());
      if (!code) {
        continue;
      }
      const key = link.userId.toString();
      const list = grouped.get(key) ?? [];
      list.push(code);
      grouped.set(key, list);
    }
    return grouped;
  }

  private async profilesOf(users: User[]) {
    const grouped = await this.roleCodesByUsers(users.map((user) => user.id));
    return users.map((user) =>
      this.profileFrom(user, grouped.get(user.id.toString()) ?? []),
    );
  }

  private profileFrom(user: User, roles: string[]): UserProfile {
    return {
      id: user.id.toString(),
      username: user.username,
      email: user.email,
      realName: user.realName,
      avatar: user.avatar,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      roles,
    };
  }

  private emptyToNull(value?: string | null) {
    const text = value?.trim();
    return text ? text : null;
  }

  private escapeLike(value: string) {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
  }
}
