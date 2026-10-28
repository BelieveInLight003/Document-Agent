import { Controller, Get, Query } from '@nestjs/common';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import { GraphNodeQueryDto } from './dto/graph-node-query.dto.js';
import { GraphRelationQueryDto } from './dto/graph-relation-query.dto.js';
import { GraphService } from './graph.service.js';

/** 图谱检索。需要登录，以及搜索权限。两个接口都返回 nodes 和 relations。 */
@Controller('graph')
@Permissions(PermissionCode.SEARCH)
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  /** 检索节点，并带上它所在的文档、切片、实体和关系，便于直接成图。 */
  @Get('nodes')
  searchNodes(@Query() query: GraphNodeQueryDto) {
    return this.graphService.searchNodes(query);
  }

  /** 检索关系，并带上关系两端以及所属文档、切片，便于直接成图。 */
  @Get('relations')
  searchRelations(@Query() query: GraphRelationQueryDto) {
    return this.graphService.searchRelations(query);
  }
}
