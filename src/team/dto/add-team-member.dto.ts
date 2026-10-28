import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { TEAM_MEMBER_ROLES } from '../team-role.js';

/** 把用户加入团队。不传角色时是普通成员。 */
export class AddTeamMemberDto {
  @IsString()
  @Matches(/^\d+$/)
  userId: string;

  @IsOptional()
  @IsString()
  @IsIn(TEAM_MEMBER_ROLES)
  memberRole?: string;
}
