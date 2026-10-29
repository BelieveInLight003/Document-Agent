import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { documentViewer } from '../document/document-access.js';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import type { UserProfile } from '../user/user.service.js';
import { SearchQueryDto } from './dto/search-query.dto.js';
import { SearchService } from './search.service.js';

/** 全文检索。需要登录，以及搜索权限。结果再按文档阅读权限过滤。 */
@Controller('search')
@Permissions(PermissionCode.SEARCH)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** 用关键词检索已发布文档，只返回当前用户能读的命中，最多 3 段高亮文段。 */
  @Get()
  search(@Req() request: Request & { user: UserProfile }, @Query() query: SearchQueryDto) {
    return this.searchService.search(documentViewer(request.user), query);
  }
}
