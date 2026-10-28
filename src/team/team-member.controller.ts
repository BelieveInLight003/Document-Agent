import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import { AddTeamMemberDto } from './dto/add-team-member.dto.js';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto.js';
import { TeamMemberService } from './team-member.service.js';

/**
 * 团队里的用户。
 * 团队维度做成员的增删改查，用户维度查询他加入了哪些团队。
 */
@Controller()
export class TeamMemberController {
  constructor(private readonly teamMembers: TeamMemberService) {}

  /** 查询某用户加入的团队。 */
  @Permissions(PermissionCode.SYSTEM_TEAM)
  @Get('users/:userId/teams')
  listByUser(@Param('userId') userId: string) {
    return this.teamMembers.listByUser(userId);
  }

  /** 查询团队成员列表。 */
  @Permissions(PermissionCode.SYSTEM_TEAM)
  @Get('teams/:teamId/members')
  list(@Param('teamId') teamId: string) {
    return this.teamMembers.list(teamId);
  }

  /** 查询团队里的一名成员。 */
  @Permissions(PermissionCode.SYSTEM_TEAM)
  @Get('teams/:teamId/members/:userId')
  findOne(
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ) {
    return this.teamMembers.findOne(teamId, userId);
  }

  /** 把用户加入团队。 */
  @Permissions(PermissionCode.SYSTEM_TEAM_EDIT)
  @Post('teams/:teamId/members')
  add(@Param('teamId') teamId: string, @Body() dto: AddTeamMemberDto) {
    return this.teamMembers.add(teamId, dto);
  }

  /** 修改成员角色。 */
  @Permissions(PermissionCode.SYSTEM_TEAM_EDIT)
  @Patch('teams/:teamId/members/:userId')
  update(
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.teamMembers.update(teamId, userId, dto);
  }

  /** 把用户移出团队。 */
  @Permissions(PermissionCode.SYSTEM_TEAM_EDIT)
  @Delete('teams/:teamId/members/:userId')
  remove(
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ) {
    return this.teamMembers.remove(teamId, userId);
  }
}
