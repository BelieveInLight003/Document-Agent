/** kh_team_member.member_role。负责人和普通成员。 */
export const TeamMemberRole = {
  LEADER: 'leader',
  MEMBER: 'member',
} as const;

export const TEAM_MEMBER_ROLES = Object.values(TeamMemberRole);
