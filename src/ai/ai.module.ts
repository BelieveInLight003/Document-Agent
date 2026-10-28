import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../document/entities/document.entity.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { ChatSchemaService } from './chat-schema.service.js';
import { ChatSessionController } from './chat-session.controller.js';
import { ChatSessionService } from './chat-session.service.js';
import { ChatMessage } from './entities/chat-message.entity.js';
import { ChatSession } from './entities/chat-session.entity.js';

/** 问答模块。检索打在切片索引上，会话和消息存在 Postgres。 */
@Module({
  imports: [TypeOrmModule.forFeature([Document, ChatSession, ChatMessage])],
  controllers: [AiController, ChatSessionController],
  providers: [AiService, ChatSessionService, ChatSchemaService],
})
export class AiModule {}
