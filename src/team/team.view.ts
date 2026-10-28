import type { User } from '../user/entities/user.entity.js';
import type { TeamMember } from './entities/team-member.entity.js';
import type { Team } from './entities/team.entity.js';

export type TeamLeaderView = {
  id: string;
  username: string;
  realName: string | null;
};

/** 团队对外返回的字段。id 用十进制字符串。 */
export type TeamView = {
  id: string;
  teamName: string;
  teamCode: string | null;
  description: string | null;
  leaderId: string | null;
  leader: TeamLeaderView | null;
  parentId: string;
  sort: number;
  status: number;
};

export type TeamMemberView = {
  id: string;
  teamId: string;
  userId: string;
  username: string | null;
  realName: string | null;
  memberRole: string;
  createdAt: Date;
};

export function teamView(team: Team, leaders: Map<string, User>): TeamView {
  const leader = team.leaderId
    ? leaders.get(team.leaderId.toString())
    : undefined;
  return {
    id: team.id.toString(),
    teamName: team.teamName,
    teamCode: team.teamCode,
    description: team.description,
    leaderId: team.leaderId?.toString() ?? null,
    leader: leader
      ? {
          id: leader.id.toString(),
          username: leader.username,
          realName: leader.realName,
        }
      : null,
    parentId: team.parentId.toString(),
    sort: team.sort,
    status: team.status,
  };
}

export function teamMemberView(
  member: TeamMember,
  users: Map<string, User>,
): TeamMemberView {
  const user = users.get(member.userId.toString());
  return {
    id: member.id.toString(),
    teamId: member.teamId.toString(),
    userId: member.userId.toString(),
    username: user?.username ?? null,
    realName: user?.realName ?? null,
    memberRole: member.memberRole,
    createdAt: member.createdAt,
  };
}
