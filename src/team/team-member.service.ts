import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from '../user/entities/user.entity.js';
import { AddTeamMemberDto } from './dto/add-team-member.dto.js';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto.js';
import { TeamMember } from './entities/team-member.entity.js';
import { Team } from './entities/team.entity.js';
import { parseSnowflakeId } from './team-id.js';
import { TeamMemberRole } from './team-role.js';
import { teamMemberView, teamView } from './team.view.js';

/**
 * 团队成员。
 * kh_team.leader_id 和成员角色 leader 保持一致：指定负责人时写入成员行，取消时把角色改回 member。
 */
@Injectable()
export class TeamMemberService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly memberRepository: Repository<TeamMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  /** 查询一个团队下的全部成员。 */
  async list(teamId: string) {
    const team = await this.requireTeam(teamId);
    const members = await this.memberRepository.find({
      where: { teamId: team.id },
      order: { createdAt: 'ASC' },
    });
    const users = await this.usersOf(members.map((member) => member.userId));
    return {
      teamId: team.id.toString(),
      members: members.map((member) => teamMemberView(member, users)),
    };
  }

  /** 查询一名成员。 */
  async findOne(teamId: string, userId: string) {
    const member = await this.requireMember(teamId, userId);
    const users = await this.usersOf([member.userId]);
    return teamMemberView(member, users);
  }

  /** 查询一个用户加入了哪些未删除的团队。 */
  async listByUser(userId: string) {
    const user = await this.requireUser(userId);
    const members = await this.memberRepository.find({
      where: { userId: user.id },
      order: { createdAt: 'ASC' },
    });
    const teams = members.length
      ? await this.teamRepository.find({
          where: {
            id: In(members.map((member) => member.teamId)),
            deleted: false,
          },
        })
      : [];
    const teamById = new Map(teams.map((team) => [team.id.toString(), team]));
    const leaders = await this.leadersOf(teams);
    return {
      userId: user.id.toString(),
      teams: members.flatMap((member) => {
        const team = teamById.get(member.teamId.toString());
        if (!team) {
          return [];
        }
        return [
          {
            ...teamView(team, leaders),
            memberRole: member.memberRole,
          },
        ];
      }),
    };
  }

  /** 加入团队。角色是 leader 时，同时改团队负责人，并把原来的负责人降为 member。 */
  async add(teamId: string, dto: AddTeamMemberDto) {
    const team = await this.requireTeam(teamId);
    const user = await this.requireUser(dto.userId);
    const existing = await this.memberRepository.findOne({
      where: { teamId: team.id, userId: user.id },
    });
    if (existing) {
      throw new ConflictException('用户已在团队中');
    }
    if (dto.memberRole === TeamMemberRole.LEADER) {
      await this.setLeader(team.id.toString(), user.id.toString());
      return this.findOne(team.id.toString(), user.id.toString());
    }
    const saved = await this.memberRepository.save(
      this.memberRepository.create({
        teamId: team.id,
        userId: user.id,
        memberRole: TeamMemberRole.MEMBER,
      }),
    );
    const users = await this.usersOf([saved.userId]);
    return teamMemberView(saved, users);
  }

  /** 修改成员角色。 */
  async update(teamId: string, userId: string, dto: UpdateTeamMemberDto) {
    const member = await this.requireMember(teamId, userId);
    if (dto.memberRole === TeamMemberRole.LEADER) {
      await this.setLeader(teamId, userId);
      return this.findOne(teamId, userId);
    }
    const team = await this.requireTeam(teamId);
    await this.dataSource.transaction(async (manager) => {
      if (team.leaderId === member.userId) {
        team.leaderId = null;
        await manager.save(team);
      }
      member.memberRole = TeamMemberRole.MEMBER;
      await manager.save(member);
    });
    return this.findOne(teamId, userId);
  }

  /** 把用户移出团队。如果他是负责人，团队的 leader_id 一并清空。 */
  async remove(teamId: string, userId: string) {
    const member = await this.requireMember(teamId, userId);
    const team = await this.requireTeam(teamId);
    await this.dataSource.transaction(async (manager) => {
      if (team.leaderId === member.userId) {
        team.leaderId = null;
        await manager.save(team);
      }
      await manager.delete(TeamMember, { id: member.id });
    });
    return {
      teamId: team.id.toString(),
      userId: member.userId.toString(),
      deleted: true,
    };
  }

  /**
   * 设置或取消负责人。
   * 传入用户 id 时，保证该用户有一条 leader 成员记录，其他 leader 降为 member。
   * 传入 null 时只取消负责人，成员记录保留并改为 member。
   */
  async setLeader(teamId: string, leaderId: string | null) {
    const team = await this.requireTeam(teamId);
    if (!leaderId) {
      await this.demoteLeaders(team.id);
      team.leaderId = null;
      await this.teamRepository.save(team);
      return;
    }
    const user = await this.requireUser(leaderId);
    const members = await this.memberRepository.find({
      where: { teamId: team.id },
    });
    const current = members.find((member) => member.userId === user.id);
    const previous = members.filter(
      (member) =>
        member.memberRole === TeamMemberRole.LEADER &&
        member.userId !== user.id,
    );
    await this.dataSource.transaction(async (manager) => {
      for (const member of previous) {
        member.memberRole = TeamMemberRole.MEMBER;
        await manager.save(member);
      }
      if (current) {
        current.memberRole = TeamMemberRole.LEADER;
        await manager.save(current);
      } else {
        await manager.save(
          manager.create(TeamMember, {
            teamId: team.id,
            userId: user.id,
            memberRole: TeamMemberRole.LEADER,
          }),
        );
      }
      team.leaderId = user.id;
      await manager.save(team);
    });
  }

  private async demoteLeaders(teamId: bigint) {
    const leaders = await this.memberRepository.find({
      where: { teamId, memberRole: TeamMemberRole.LEADER },
    });
    for (const member of leaders) {
      member.memberRole = TeamMemberRole.MEMBER;
      await this.memberRepository.save(member);
    }
  }

  private async requireTeam(teamId: string) {
    const team = await this.teamRepository.findOne({
      where: { id: parseSnowflakeId(teamId, '团队'), deleted: false },
    });
    if (!team) {
      throw new NotFoundException('团队不存在');
    }
    return team;
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

  private async requireMember(teamId: string, userId: string) {
    const team = await this.requireTeam(teamId);
    const user = await this.requireUser(userId);
    const member = await this.memberRepository.findOne({
      where: { teamId: team.id, userId: user.id },
    });
    if (!member) {
      throw new NotFoundException('成员不存在');
    }
    return member;
  }

  private async usersOf(userIds: bigint[]) {
    if (userIds.length === 0) {
      return new Map<string, User>();
    }
    const users = await this.userRepository.find({
      where: { id: In(userIds) },
    });
    return new Map(users.map((user) => [user.id.toString(), user]));
  }

  private async leadersOf(teams: Team[]) {
    const leaderIds = teams.flatMap((team) =>
      team.leaderId ? [team.leaderId] : [],
    );
    return this.usersOf(leaderIds);
  }
}
