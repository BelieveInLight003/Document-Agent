import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import { RoleCode } from '../user/role-code.js';
import { CreateTeamDto } from './dto/create-team.dto.js';
import { TeamQueryDto } from './dto/team-query.dto.js';
import { UpdateTeamDto } from './dto/update-team.dto.js';
import { TeamService } from './team.service.js';

/** 团队资料。需要管理员角色，以及 system:team 权限。 */
@Controller('teams')
@Roles(RoleCode.ADMIN)
@Permissions(PermissionCode.SYSTEM_TEAM)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  /** 新建团队。 */
  @Post()
  create(@Body() dto: CreateTeamDto) {
    return this.teamService.create(dto);
  }

  /** 团队列表。 */
  @Get()
  findAll(@Query() query: TeamQueryDto) {
    return this.teamService.findAll(query);
  }

  /** 查询一个团队。 */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.teamService.findOne(id);
  }

  /** 修改团队。 */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.teamService.update(id, dto);
  }

  /** 软删除团队。 */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.teamService.remove(id);
  }
}
