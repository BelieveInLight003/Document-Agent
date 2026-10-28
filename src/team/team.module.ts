import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/entities/user.entity.js';
import { TeamMember } from './entities/team-member.entity.js';
import { Team } from './entities/team.entity.js';
import { TeamMemberController } from './team-member.controller.js';
import { TeamMemberService } from './team-member.service.js';
import { TeamController } from './team.controller.js';
import { TeamService } from './team.service.js';

/** 团队模块。团队资料和成员关联分开，负责人变更由成员服务同步 leader_id。 */
@Module({
  imports: [TypeOrmModule.forFeature([Team, TeamMember, User])],
  controllers: [TeamController, TeamMemberController],
  providers: [TeamService, TeamMemberService],
})
export class TeamModule {}
