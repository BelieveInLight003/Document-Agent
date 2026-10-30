import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { DocumentViewer } from '../document/document-access.js';
import { GraphService } from '../graph/graph.service.js';
import { AiService } from './ai.service.js';
import type { HybridHitView } from './ai.view.js';
import { ChatMemoryService } from './chat-memory.service.js';
import { needsRewrite } from './chat-memory.js';
import { createAnswerStream } from './chat-stream.js';
import type { ChatMessagePayload, ChatStep } from './chat-step.js';
import { ChatMessage } from './entities/chat-message.entity.js';
import { ChatSession } from './entities/chat-session.entity.js';
import { formatLongTerm } from './mem0-memory.js';
import { Mem0MemoryService } from './mem0-memory.service.js';
import { graphKeyword, graphPassages } from './graph-passages.js';
import { searchBocha } from './bocha-search.js';
import { hitTrace, startChatTrace } from './langsmith.js';

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
  steps: ChatStep[] | null;
  createdAt: Date;
};

@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);

  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    private readonly aiService: AiService,
    private readonly memory: ChatMemoryService,
    private readonly longTerm: Mem0MemoryService,
    private readonly graphService: GraphService,
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
    await this.memory.forget(session.id);
    await this.longTerm.forgetSession(userId, session.id);
    return { id: session.id.toString() };
  }

  /** 在会话里记一条提问，并保存这次混合检索的结果。检索按当前用户的文档权限过滤。 */
  async ask(
    userId: string,
    id: string,
    question: string,
    limit: number | undefined,
    viewer: DocumentViewer,
  ) {
    const session = await this.requireSession(userId, id);
    const asked = question.trim();
    const trace = startChatTrace('会话检索', { question: asked }, { sessionId: session.id.toString(), userId });
    try {
      const { prepared } = await trace.span(
        '整理问题',
        'chain',
        { question: asked },
        () => this.prepareQuestion(userId, session.id, asked),
        (value) => ({
          searchQuestion: value.prepared.question,
          rewritten: value.prepared.question !== asked,
          context: value.contextLabel,
        }),
      );
      const result = await trace.span(
        '文档检索',
        'retriever',
        { query: prepared.question, limit: limit ?? 5 },
        () => this.aiService.retrieve(viewer, { question: prepared.question, limit }),
        (found) => hitTrace(found.items),
      );
      const saved = await this.dataSource.transaction(async (manager) => {
        const userMessage = await manager.save(
          this.messageRepository.create({
            sessionId: session.id,
            role: 'user',
            content: asked,
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
          session.title = asked.slice(0, TITLE_LENGTH);
        }
        session.updatedAt = new Date();
        const savedSession = await manager.save(session);
        return { savedSession, userMessage, assistantMessage };
      });
      await this.memory.remember(
        session.id,
        prepared.snapshot,
        asked,
        saved.assistantMessage.content,
      );
      await trace.end({ count: result.items.length, searchQuestion: result.question });
      return {
        session: sessionView(saved.savedSession),
        messages: [messageView(saved.userMessage), messageView(saved.assistantMessage)],
      };
    } catch (error) {
      await trace.end({}, error);
      throw error;
    }
  }

  /** 校验会话后返回 UI Message Stream。步骤、检索和回答都从这个流里推，检索遵守文档权限。 */
  openStream(
    userId: string,
    id: string,
    question: string,
    limit: number | undefined,
    viewer: DocumentViewer,
  ) {
    const text = question.trim();
    if (!text) {
      throw new BadRequestException('问题不能为空');
    }
    return this.requireSession(userId, id).then(async (session) => {
      const trace = startChatTrace(
        '会话问答',
        { question: text },
        { sessionId: session.id.toString(), userId },
      );
      try {
        const { prepared, reuse, hinted, contextLabel } = await trace.span(
          '整理问题',
          'chain',
          { question: text },
          () => this.prepareQuestion(userId, session.id, text),
          (value) => ({
            searchQuestion: value.prepared.question,
            rewritten: value.prepared.question !== text,
            context: value.contextLabel,
            longTermHints: value.hinted.map((item) => ({ scope: item.scope, text: item.text })),
          }),
        );
        const abort = new AbortController();
        const stream = createAnswerStream({
          question: text,
          searchQuestion: prepared.question,
          memory: prepared.memoryText,
          contextLabel,
          limit: limit ?? 5,
          abortSignal: abort.signal,
          trace,
          retrieve: (searchText, size) =>
            trace.span(
              '文档检索',
              'retriever',
              { query: searchText, limit: size },
              async () => {
                const result = await this.aiService.retrieve(viewer, {
                  question: searchText,
                  limit: size,
                });
                return result.items;
              },
              hitTrace,
            ),
          retrieveGraph: (searchText, size) =>
            trace.span(
              '图谱检索',
              'retriever',
              { query: searchText, limit: size },
              async () => {
                const view = await this.graphService.searchNodes(viewer, {
                  keyword: searchText,
                  limit: size,
                });
                const passages = graphPassages(view, size);
                const shorter = graphKeyword(searchText);
                if (passages.length > 0 || !shorter || shorter === searchText.trim()) return passages;
                const again = await this.graphService.searchNodes(viewer, {
                  keyword: shorter,
                  limit: size,
                });
                return graphPassages(again, size);
              },
              hitTrace,
            ),
          retrieveWeb: (searchText, size) =>
            trace.span(
              '联网检索',
              'retriever',
              { query: searchText, limit: size },
              () => searchBocha(searchText, size, abort.signal),
              hitTrace,
            ),
          recall: (query) =>
            trace.span(
              '长期记忆检索',
              'retriever',
              { query },
              async () => {
                const found =
                  reuse && query === prepared.question
                    ? hinted
                    : await this.longTerm.search(userId, session.id, query);
                return {
                  text: formatLongTerm(found),
                  count: found.length,
                  memories: found.map((item) => ({ scope: item.scope, text: item.text })),
                };
              },
              (found) => ({ count: found.count, memories: found.memories }),
            ),
          onEnd: async (result) => {
            try {
              if (!result.answer.trim()) return;
              await this.saveTurn(session, {
                question: text,
                answer: result.answer,
                items: result.items,
                steps: result.steps,
              });
              await this.memory.remember(session.id, prepared.snapshot, text, result.answer);
              if (!result.aborted) {
                await trace.span(
                  '沉淀长期记忆',
                  'chain',
                  { question: text },
                  () => this.longTerm.retain(userId, session.id, text, result.answer),
                  (notes) => ({ notes }),
                );
              }
            } catch (error) {
              this.logger.error(
                '保存问答失败',
                error instanceof Error ? error.stack : String(error),
              );
            } finally {
              await trace.end({
                answer: result.answer,
                aborted: result.aborted,
                documents: result.items.length,
              });
            }
          },
        });
        return { stream, cancel: () => abort.abort() };
      } catch (error) {
        await trace.end({}, error);
        throw error;
      }
    });
  }

  /**
   * 指代不清时，先用原问题查一次长期记忆，连同 Redis 上文一起改写。
   * 改写没有改变句子时，这次结果可以留给正式检索复用。
   * 非流式 ask 只用改写后的问题做文档检索，不生成回答，也不写入 Mem0。
   */
  private async prepareQuestion(userId: string, sessionId: bigint, question: string) {
    const hinted = needsRewrite(question)
      ? await this.longTerm.search(userId, sessionId, question)
      : [];
    const prepared = await this.memory.prepare(sessionId, question, formatLongTerm(hinted));
    const contextLabel =
      hinted.length > 0 && prepared.memoryText
        ? '上文和长期记忆'
        : hinted.length > 0
          ? '长期记忆'
          : '上文';
    return {
      prepared,
      hinted,
      reuse: needsRewrite(question) && prepared.question === question,
      contextLabel,
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

  private async saveTurn(
    session: ChatSession,
    input: { question: string; answer: string; items: HybridHitView[]; steps: ChatStep[] },
  ) {
    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        this.messageRepository.create({
          sessionId: session.id,
          role: 'user',
          content: input.question,
          payload: null,
        }),
      );
      await manager.save(
        this.messageRepository.create({
          sessionId: session.id,
          role: 'assistant',
          content: input.answer,
          payload: { items: input.items, steps: input.steps },
        }),
      );
      if (session.title === DEFAULT_TITLE) {
        session.title = input.question.slice(0, TITLE_LENGTH);
      }
      session.updatedAt = new Date();
      await manager.save(session);
    });
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
  const stored = readStored(message.payload);
  return {
    id: message.id.toString(),
    sessionId: message.sessionId.toString(),
    role: message.role,
    content: message.content,
    items: stored.items,
    steps: stored.steps,
    createdAt: message.createdAt,
  };
}

function readStored(payload: ChatMessage['payload']): {
  items: HybridHitView[] | null;
  steps: ChatStep[] | null;
} {
  if (Array.isArray(payload)) {
    return { items: payload, steps: null };
  }
  if (!payload || typeof payload !== 'object') {
    return { items: null, steps: null };
  }
  const stored = payload as ChatMessagePayload;
  return {
    items: Array.isArray(stored.items) ? stored.items : null,
    steps: Array.isArray(stored.steps) ? stored.steps : null,
  };
}
