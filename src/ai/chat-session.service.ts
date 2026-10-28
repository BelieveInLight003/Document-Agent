import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AiService } from './ai.service.js';
import type { HybridHitView } from './ai.view.js';
import { ChatMessage } from './entities/chat-message.entity.js';
import { ChatSession } from './entities/chat-session.entity.js';

const DEFAULT_TITLE = '新会话';
const TITLE_LENGTH = 40;

export type ChatSessionView = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChatMessageView = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  items: HybridHitView[] | null;
  createdAt: Date;
};

@Injectable()
export class ChatSessionService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    private readonly aiService: AiService,
    private readonly dataSource: DataSource,
  ) {}

  async list(userId: string) {
    const rows = await this.sessionRepository.find({
      where: { userId: this.userKey(userId) },
      order: { updatedAt: 'DESC', id: 'DESC' },
      take: 100,
    });
    return { list: rows.map(sessionView) };
  }

  async create(userId: string, title?: string) {
    const session = await this.sessionRepository.save(
      this.sessionRepository.create({
        userId: this.userKey(userId),
        title: title?.trim() || DEFAULT_TITLE,
      }),
    );
    return sessionView(session);
  }

  async findOne(userId: string, id: string) {
    const session = await this.requireSession(userId, id);
    const messages = await this.messagesOf(session.id);
    return { session: sessionView(session), messages };
  }

  async update(userId: string, id: string, title: string) {
    const session = await this.requireSession(userId, id);
    session.title = title.trim();
    const saved = await this.sessionRepository.save(session);
    return sessionView(saved);
  }

  async remove(userId: string, id: string) {
    const session = await this.requireSession(userId, id);
    await this.sessionRepository.delete({ id: session.id });
    return { id: session.id.toString() };
  }

  /** 在会话里记一条提问，并保存这次混合检索的结果。 */
  async ask(userId: string, id: string, question: string, limit?: number) {
    const session = await this.requireSession(userId, id);
    const result = await this.aiService.retrieve({ question, limit });
    const saved = await this.dataSource.transaction(async (manager) => {
      const userMessage = await manager.save(
        this.messageRepository.create({
          sessionId: session.id,
          role: 'user',
          content: result.question,
          payload: null,
        }),
      );
      const assistantMessage = await manager.save(
        this.messageRepository.create({
          sessionId: session.id,
          role: 'assistant',
          content:
            result.items.length === 0
              ? '没有检索到相关资料。'
              : `混合检索 ${result.items.length} 条`,
          payload: result.items,
        }),
      );
      if (session.title === DEFAULT_TITLE) {
        session.title = result.question.slice(0, TITLE_LENGTH);
      }
      session.updatedAt = new Date();
      const savedSession = await manager.save(session);
      return { savedSession, userMessage, assistantMessage };
    });
    return {
      session: sessionView(saved.savedSession),
      messages: [messageView(saved.userMessage), messageView(saved.assistantMessage)],
    };
  }

  private async messagesOf(sessionId: bigint) {
    const rows = await this.messageRepository.find({
      where: { sessionId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return rows.map(messageView);
  }

  private async requireSession(userId: string, id: string) {
    if (!/^\d+$/.test(id)) {
      throw new NotFoundException('会话不存在');
    }
    const session = await this.sessionRepository.findOne({
      where: { id: BigInt(id), userId: this.userKey(userId) },
    });
    if (!session) {
      throw new NotFoundException('会话不存在');
    }
    return session;
  }

  private userKey(userId: string) {
    if (!/^\d+$/.test(userId)) {
      throw new NotFoundException('会话不存在');
    }
    return BigInt(userId);
  }
}

function sessionView(session: ChatSession): ChatSessionView {
  return {
    id: session.id.toString(),
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function messageView(message: ChatMessage): ChatMessageView {
  return {
    id: message.id.toString(),
    sessionId: message.sessionId.toString(),
    role: message.role,
    content: message.content,
    items: Array.isArray(message.payload) ? message.payload : null,
    createdAt: message.createdAt,
  };
}
