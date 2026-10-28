import { Controller, Get, Query } from '@nestjs/common';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import { SearchQueryDto } from './dto/search-query.dto.js';
import { SearchService } from './search.service.js';

/** 全文检索。需要登录，以及搜索权限。 */
@Controller('search')
@Permissions(PermissionCode.SEARCH)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** 用关键词检索已发布文档，返回最多 3 段高亮文段。 */
  @Get()
  search(@Query() query: SearchQueryDto) {
    return this.searchService.search(query);
  }
}
