import { IsIn, IsString } from 'class-validator';
import { TEAM_MEMBER_ROLES } from '../team-role.js';

/** 修改成员在团队里的角色。改成 leader 时，原负责人降为 member。 */
export class UpdateTeamMemberDto {
  @IsString()
  @IsIn(TEAM_MEMBER_ROLES)
  memberRole: string;
}
