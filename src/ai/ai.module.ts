import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../document/entities/document.entity.js';
import { GraphModule } from '../graph/graph.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { ChatMemoryService } from './chat-memory.service.js';
import { ChatSchemaService } from './chat-schema.service.js';
import { ChatSessionController } from './chat-session.controller.js';
import { ChatSessionService } from './chat-session.service.js';
import { ChatMessage } from './entities/chat-message.entity.js';
import { ChatSession } from './entities/chat-session.entity.js';
import { Mem0MemoryService } from './mem0-memory.service.js';

/** 问答模块。文档检索在切片索引上，图谱检索在 Neo4j，会话正文在 Postgres，24 小时对话在 Redis，长期记忆在 Mem0。 */
@Module({
  imports: [TypeOrmModule.forFeature([Document, ChatSession, ChatMessage]), RedisModule, GraphModule],
  controllers: [AiController, ChatSessionController],
  providers: [AiService, ChatSessionService, ChatSchemaService, ChatMemoryService, Mem0MemoryService],
})
export class AiModule {}
