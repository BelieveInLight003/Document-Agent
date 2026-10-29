import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { documentViewer } from '../document/document-access.js';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import type { UserProfile } from '../user/user.service.js';
import { GraphNodeQueryDto } from './dto/graph-node-query.dto.js';
import { GraphRelationQueryDto } from './dto/graph-relation-query.dto.js';
import { GraphService } from './graph.service.js';

/** 图谱检索。需要登录，以及搜索权限。两个接口都返回 nodes 和 relations，并按文档阅读权限过滤。 */
@Controller('graph')
@Permissions(PermissionCode.SEARCH)
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  /** 检索节点，并带上它所在的文档、切片、实体和关系。看不到的文档不会出现在图里。 */
  @Get('nodes')
  searchNodes(@Req() request: Request & { user: UserProfile }, @Query() query: GraphNodeQueryDto) {
    return this.graphService.searchNodes(documentViewer(request.user), query);
  }

  /** 检索关系，并带上关系两端以及所属文档、切片。看不到的文档上的边会被去掉。 */
  @Get('relations')
  searchRelations(
    @Req() request: Request & { user: UserProfile },
    @Query() query: GraphRelationQueryDto,
  ) {
    return this.graphService.searchRelations(documentViewer(request.user), query);
  }
}
