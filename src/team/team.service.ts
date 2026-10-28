import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from '../user/entities/user.entity.js';
import { UserStatus } from '../user/user-status.js';
import { CreateTeamDto } from './dto/create-team.dto.js';
import { TeamQueryDto } from './dto/team-query.dto.js';
import { UpdateTeamDto } from './dto/update-team.dto.js';
import { TeamMember } from './entities/team-member.entity.js';
import { Team } from './entities/team.entity.js';
import { parseSnowflakeId } from './team-id.js';
import { TeamMemberService } from './team-member.service.js';
import { teamView } from './team.view.js';

/** 团队本身的增删改查。成员和负责人同步交给 TeamMemberService。 */
@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly teamMembers: TeamMemberService,
    private readonly dataSource: DataSource,
  ) {}

  /** 新建团队。指定了负责人时，同时写入一条 leader 成员。 */
  async create(dto: CreateTeamDto) {
    const teamCode = this.emptyToNull(dto.teamCode);
    if (teamCode) {
      await this.ensureCodeAvailable(teamCode);
    }
    const parentId = await this.resolveParent(dto.parentId);
    if (dto.leaderId) {
      await this.requireUser(dto.leaderId);
    }
    const saved = await this.teamRepository.save(
      this.teamRepository.create({
        teamName: dto.teamName.trim(),
        teamCode,
        description: this.emptyToNull(dto.description),
        leaderId: null,
        parentId,
        sort: dto.sort ?? 0,
        status: dto.status ?? UserStatus.ENABLED,
        deleted: false,
      }),
    );
    if (dto.leaderId) {
      await this.teamMembers.setLeader(saved.id.toString(), dto.leaderId);
    }
    return this.findOne(saved.id.toString());
  }

  /** 按父团队、编码、状态筛选未删除的团队。 */
  async findAll(query: TeamQueryDto) {
    const teams = await this.teamRepository.find({
      where: {
        deleted: false,
        ...(query.parentId !== undefined
          ? { parentId: parseSnowflakeId(query.parentId, '父团队') }
          : {}),
        ...(query.teamCode ? { teamCode: query.teamCode.trim() } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
      },
      order: { sort: 'ASC', id: 'ASC' },
    });
    return this.viewsOf(teams);
  }

  /** 查询一个团队，带上负责人的用户名。 */
  async findOne(id: string) {
    const team = await this.requireActive(id);
    const [view] = await this.viewsOf([team]);
    return view;
  }

  /** 修改团队资料。leaderId 有值或为 null 时，同步成员角色。 */
  async update(id: string, dto: UpdateTeamDto) {
    const team = await this.requireActive(id);
    if (dto.teamCode !== undefined) {
      const teamCode = this.emptyToNull(dto.teamCode);
      if (teamCode) {
        await this.ensureCodeAvailable(teamCode, team.id);
      }
      team.teamCode = teamCode;
    }
    if (dto.parentId !== undefined) {
      team.parentId = await this.resolveParent(dto.parentId, team.id);
    }
    if (dto.teamName !== undefined) {
      team.teamName = dto.teamName.trim();
    }
    if (dto.description !== undefined) {
      team.description = this.emptyToNull(dto.description);
    }
    if (dto.sort !== undefined) {
      team.sort = dto.sort;
    }
    if (dto.status !== undefined) {
      team.status = dto.status;
    }
    if (dto.leaderId) {
      await this.requireUser(dto.leaderId);
    }
    await this.teamRepository.save(team);
    if (dto.leaderId !== undefined) {
      await this.teamMembers.setLeader(team.id.toString(), dto.leaderId);
    }
    return this.findOne(team.id.toString());
  }

  /** 软删除。有子团队时先要求处理子级，同时清掉成员关联。 */
  async remove(id: string) {
    const team = await this.requireActive(id);
    const child = await this.teamRepository.findOne({
      where: { parentId: team.id, deleted: false },
    });
    if (child) {
      throw new BadRequestException('请先删除子团队');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(TeamMember, { teamId: team.id });
      team.deleted = true;
      team.leaderId = null;
      await manager.save(team);
    });
    return { id: team.id.toString(), deleted: true };
  }

  private async requireUser(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: parseSnowflakeId(userId, '用户'), deleted: false },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  private async viewsOf(teams: Team[]) {
    const leaderIds = teams.flatMap((team) =>
      team.leaderId ? [team.leaderId] : [],
    );
    const leaders = leaderIds.length
      ? await this.userRepository.find({ where: { id: In(leaderIds) } })
      : [];
    const leaderById = new Map(
      leaders.map((leader) => [leader.id.toString(), leader]),
    );
    return teams.map((team) => teamView(team, leaderById));
  }

  private async requireActive(id: string) {
    const team = await this.teamRepository.findOne({
      where: { id: parseSnowflakeId(id, '团队'), deleted: false },
    });
    if (!team) {
      throw new NotFoundException('团队不存在');
    }
    return team;
  }

  private async resolveParent(parentId: string | undefined, selfId?: bigint) {
    const parent = parseSnowflakeId(parentId ?? '0', '父团队');
    if (parent === 0n) {
      return parent;
    }
    if (selfId && parent === selfId) {
      throw new BadRequestException('父团队不能是自己');
    }
    const seen = new Set<string>();
    let current = parent;
    while (current !== 0n) {
      const key = current.toString();
      if (selfId && current === selfId) {
        throw new BadRequestException('父团队不能是自己的子团队');
      }
      if (seen.has(key)) {
        throw new BadRequestException('父团队形成了循环');
      }
      seen.add(key);
      const node = await this.teamRepository.findOne({
        where: { id: current, deleted: false },
      });
      if (!node) {
        throw new NotFoundException('父团队不存在');
      }
      current = node.parentId;
    }
    return parent;
  }

  private async ensureCodeAvailable(teamCode: string, exceptId?: bigint) {
    const existing = await this.teamRepository.findOne({
      where: { teamCode, deleted: false },
    });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('团队编码已存在');
    }
  }

  private emptyToNull(value?: string | null) {
    const text = value?.trim();
    return text ? text : null;
  }
}
