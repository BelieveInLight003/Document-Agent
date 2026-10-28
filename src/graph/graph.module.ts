import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../document/entities/document.entity.js';
import { GraphController } from './graph.controller.js';
import { GraphService } from './graph.service.js';

/** 图谱检索。图在 Neo4j，文档节点再用 Postgres 的 content_id 补全资料。 */
@Module({
  imports: [TypeOrmModule.forFeature([Document])],
  controllers: [GraphController],
  providers: [GraphService],
})
export class GraphModule {}
