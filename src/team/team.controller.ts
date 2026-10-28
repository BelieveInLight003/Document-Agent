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
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import { CreateTeamDto } from './dto/create-team.dto.js';
import { TeamQueryDto } from './dto/team-query.dto.js';
import { UpdateTeamDto } from './dto/update-team.dto.js';
import { TeamService } from './team.service.js';

/** 团队资料。按按钮权限区分查看、新建、修改和删除。 */
@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  /** 新建团队。 */
  @Permissions(PermissionCode.SYSTEM_TEAM_CREATE)
  @Post()
  create(@Body() dto: CreateTeamDto) {
    return this.teamService.create(dto);
  }

  /** 团队列表。 */
  @Permissions(PermissionCode.SYSTEM_TEAM)
  @Get()
  findAll(@Query() query: TeamQueryDto) {
    return this.teamService.findAll(query);
  }

  /** 查询一个团队。 */
  @Permissions(PermissionCode.SYSTEM_TEAM)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.teamService.findOne(id);
  }

  /** 修改团队。 */
  @Permissions(PermissionCode.SYSTEM_TEAM_EDIT)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.teamService.update(id, dto);
  }

  /** 软删除团队。 */
  @Permissions(PermissionCode.SYSTEM_TEAM_DELETE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.teamService.remove(id);
  }
}
