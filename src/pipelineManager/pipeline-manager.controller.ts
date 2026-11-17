import { Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { RoleCode } from '../user/role-code.js';
import { PipelineManagerService } from './pipeline-manager.service.js';

@Controller('pipeline/jobs')
@Roles(RoleCode.ADMIN)
export class PipelineManagerController {
  constructor(private readonly pipeline: PipelineManagerService) {}

  @Get()
  list() {
    return this.pipeline.listJobs();
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.pipeline.retryJob(id);
  }
}
