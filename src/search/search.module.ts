import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../document/entities/document.entity.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

/** 关键词全文检索。索引在 Elasticsearch，文档资料从 Postgres 按 content_id 取回。 */
@Module({
  imports: [TypeOrmModule.forFeature([Document])],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
