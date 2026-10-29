import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { tracedGenerateText } from './langsmith.js';
import { Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service.js';
import {
  MEMORY_FALLBACK_LIMIT,
  MEMORY_TTL_MS,
  appendTurn,
  cleanRewrite,
  formatMemory,
  hasMemory,
  memoryKey,
  needsRewrite,
  splitForSummary,
  type ChatMemory,
  type MemoryTurn,
} from './chat-memory.js';
import { createChatModel } from './chat-model.js';
import { ChatMessage } from './entities/chat-message.entity.js';

/**
 * 一次提问前准备好的记忆。
 * question 是拿去检索和回答的问题：指代不清时已被改写，否则就是原话。
 * memoryText 是摘要加最近对话，拼进回答提示词。
 * snapshot 是这次提问之前的记忆，回答结束后再把新的一轮补回去。
 */
export type PreparedMemory = {
  question: string;
  memoryText: string;
  snapshot: ChatMemory;
};

/**
 * 短期记忆的读写。
 * 先读 Redis；过期或没有时，用 Postgres 最近 20 条消息回填，并重新计 24 小时。
 * 同一会话同时有两条提问时，后写完的记忆会盖住先写完的那次。
 */
@Injectable()
export class ChatMemoryService {
  private readonly logger = new Logger(ChatMemoryService.name);

  constructor(
    private readonly redis: RedisService,
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
  ) {}

  /**
   * 读出上文，并在问题含糊时改写成可以单独检索的问句。
   * longTermText 是 Mem0 里已经检索到的长期记忆。没有上文时，只靠它也能消解指代。
   */
  async prepare(sessionId: bigint, question: string, longTermText = ''): Promise<PreparedMemory> {
    const snapshot = await this.load(sessionId);
    const memoryText = formatMemory(snapshot);
    const rewritten = await this.rewrite(question, memoryText, longTermText);
    return { question: rewritten, memoryText, snapshot };
  }

  /**
   * 回答结束后把这一轮写入 Redis。
   * fallback 是提问前的记忆。Redis 在回答期间被清掉时，用它接着写，避免只剩最新一句。
   */
  async remember(sessionId: bigint, fallback: ChatMemory, question: string, answer: string) {
    try {
      const current = (await this.read(sessionId)) ?? fallback;
      const next = appendTurn(current, question, answer);
      const compact = await this.compress(next);
      await this.write(sessionId, compact);
    } catch (error) {
      this.logger.error('写入短期记忆失败', error instanceof Error ? error.stack : String(error));
    }
  }

  /** 删除会话时清掉 Redis。过期的钥匙删不到也没有关系。 */
  async forget(sessionId: bigint) {
    try {
      await this.redis.del(memoryKey(sessionId.toString()));
    } catch (error) {
      this.logger.error('删除短期记忆失败', error instanceof Error ? error.stack : String(error));
    }
  }

  /** Redis 优先。没有就从 Postgres 回填 20 条，并写回 Redis。 */
  private async load(sessionId: bigint) {
    const cached = await this.read(sessionId);
    if (cached) {
      await this.write(sessionId, cached);
      return cached;
    }
    const restored = await this.restore(sessionId);
    if (hasMemory(restored)) {
      const compact = await this.compress(restored);
      await this.write(sessionId, compact);
      return compact;
    }
    return restored;
  }

  private async read(sessionId: bigint): Promise<ChatMemory | null> {
    try {
      const raw = await this.redis.get<string | ChatMemory>(memoryKey(sessionId.toString()));
      return parseMemory(raw);
    } catch (error) {
      this.logger.error('读取短期记忆失败', error instanceof Error ? error.stack : String(error));
      return null;
    }
  }

  private async write(sessionId: bigint, memory: ChatMemory) {
    await this.redis.set(memoryKey(sessionId.toString()), JSON.stringify(memory), MEMORY_TTL_MS);
  }

  /** 最近 20 条消息，按时间从旧到新。只取角色和正文。 */
  private async restore(sessionId: bigint): Promise<ChatMemory> {
    const rows = await this.messages.find({
      where: { sessionId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: MEMORY_FALLBACK_LIMIT,
    });
    const turns: MemoryTurn[] = rows.reverse().flatMap((row) => {
      if (row.role !== 'user' && row.role !== 'assistant') {
        return [];
      }
      const content = row.content.trim();
      if (!content) {
        return [];
      }
      return [{ role: row.role, content }];
    });
    return { summary: '', turns };
  }

  /**
   * 问题里有指代或追问，并且短期记忆或长期记忆至少有一边有内容时，改写成独立问题。
   * 改写失败或结果是空的，就继续用用户原话检索。
   */
  private async rewrite(question: string, memoryText: string, longTermText: string) {
    const blocks = [
      memoryText.trim() ? `对话记忆：\n${memoryText.trim()}` : '',
      longTermText.trim() ? `长期记忆：\n${longTermText.trim()}` : '',
    ].filter((block) => block.length > 0);
    if (blocks.length === 0 || !needsRewrite(question)) {
      return question;
    }
    try {
      const { text } = await tracedGenerateText({
        model: createChatModel(),
        temperature: 0,
        system: [
          '你负责把用户的最新问题改写成可以单独拿去检索的一句话。',
          '只根据对话记忆和长期记忆消解这个、那个、它、刚才这类指代，不要补充记忆里没有的事实。',
          '问题本身已经完整时，原样输出。',
          '只输出问题本身，不要回答，不要加引号。',
        ].join('\n'),
        prompt: `${blocks.join('\n\n')}\n\n最新问题：\n${question}`,
      });
      return cleanRewrite(text) || question;
    } catch (error) {
      this.logger.error('改写问题失败', error instanceof Error ? error.stack : String(error));
      return question;
    }
  }

  /**
   * 原文超过 12 条时，把靠前部分并进摘要，最近 8 条留下。
   * 摘要失败时不删原文，下一轮再试。
   */
  private async compress(memory: ChatMemory): Promise<ChatMemory> {
    const split = splitForSummary(memory);
    if (!split) {
      return memory;
    }
    try {
      const summary = await this.summarize(memory.summary, split.head);
      if (!summary) {
        return memory;
      }
      return { summary, turns: split.recent };
    } catch (error) {
      this.logger.error('压缩对话记忆失败', error instanceof Error ? error.stack : String(error));
      return memory;
    }
  }

  /** 把已有摘要和更早的原文合成一段新摘要。 */
  private async summarize(summary: string, turns: MemoryTurn[]) {
    const history = turns
      .map((turn) => `${turn.role === 'user' ? '用户' : '助手'}：${turn.content}`)
      .join('\n');
    const { text } = await tracedGenerateText({
      model: createChatModel(),
      temperature: 0,
      system: [
        '把较早的对话压成一段简短摘要。',
        '保留人名、对象、已经得出的结论，以及还没说完的问题。',
        '已有摘要里的信息要合并进去，不能丢掉。',
        '只输出摘要，不要加标题。',
      ].join('\n'),
      prompt: `已有摘要：\n${summary.trim() || '无'}\n\n需要并入的对话：\n${history}`,
    });
    const next = text.trim();
    return next ? [...next].slice(0, 800).join('') : '';
  }
}

/** Redis 里可能是 JSON 字符串，也可能已经被缓存层解析成对象。对不上结构就当成没有记忆。 */
function parseMemory(raw: string | ChatMemory | null | undefined): ChatMemory | null {
  const value = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!value || typeof value !== 'object') {
    return null;
  }
  const summary = 'summary' in value && typeof value.summary === 'string' ? value.summary : '';
  const turns = 'turns' in value && Array.isArray(value.turns) ? value.turns.flatMap(parseTurn) : [];
  // 空对象不能当成命中，否则 Redis 里的空壳会挡住 Postgres 回填。
  if (!summary && turns.length === 0) {
    return null;
  }
  return { summary, turns };
}

function parseTurn(value: unknown): MemoryTurn[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const role = 'role' in value ? value.role : undefined;
  const content = 'content' in value ? value.content : undefined;
  if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
    return [];
  }
  const text = content.trim();
  return text ? [{ role, content: text }] : [];
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
