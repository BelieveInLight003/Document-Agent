import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../document/entities/document.entity.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';

/** 问答模块。检索打在切片索引上，文档标题从 Postgres 取。 */
@Module({
  imports: [TypeOrmModule.forFeature([Document])],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
