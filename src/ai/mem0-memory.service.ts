import { Injectable, Logger } from '@nestjs/common';
import { tracedGenerateText } from './langsmith.js';
import { createChatModel } from './chat-model.js';
import { Mem0Client } from './mem0-client.js';
import { canRetain, parseMemoryNotes, type LongMemory, type MemoryNote } from './mem0-memory.js';

/**
 * 长期记忆的检索、分类和清理。
 * 检索失败时返回空，不挡住文档检索和回答。
 * 写入失败只记日志。Postgres 和 Redis 已经各自保存了这一轮。
 */
@Injectable()
export class Mem0MemoryService {
  private readonly logger = new Logger(Mem0MemoryService.name);
  private readonly client = new Mem0Client();

  /** 用改写后的问题检索。永久信息和当前会话信息合并返回。 */
  async search(userId: string, sessionId: bigint, query: string): Promise<LongMemory[]> {
    if (!this.client.enabled()) return [];
    try {
      return await this.client.search(userId, sessionId.toString(), query);
    } catch (error) {
      this.logger.error('检索长期记忆失败', error instanceof Error ? error.stack : String(error));
      return [];
    }
  }

  /**
   * 回答已经写入 Postgres 和 Redis 之后调用。
   * 先把本会话已有记忆的到期时间续上，再判断这一轮要不要新增。
   * 不需要存储时什么都不写。需要存储时按 fact 或 session 分开写入。
   */
  async retain(
    userId: string,
    sessionId: bigint,
    question: string,
    answer: string,
  ): Promise<MemoryNote[]> {
    if (!this.client.enabled()) return [];
    const sessionKey = sessionId.toString();
    try {
      await this.client.extendSession(userId, sessionKey);
    } catch (error) {
      this.logger.error('续期会话记忆失败', error instanceof Error ? error.stack : String(error));
    }
    if (!canRetain(answer)) return [];
    try {
      const notes = await this.classify(question, answer);
      for (const note of notes) {
        await this.client.add(userId, sessionKey, note);
      }
      return notes;
    } catch (error) {
      this.logger.error('写入长期记忆失败', error instanceof Error ? error.stack : String(error));
      return [];
    }
  }

  /** 删除会话时清掉会话记忆。永久信息留着。 */
  async forgetSession(userId: string, sessionId: bigint) {
    if (!this.client.enabled()) return;
    try {
      await this.client.forgetSession(userId, sessionId.toString());
    } catch (error) {
      this.logger.error('删除会话记忆失败', error instanceof Error ? error.stack : String(error));
    }
  }

  /**
   * 判断这一轮有没有值得留下的信息。
   * fact 是跨会话仍成立的用户信息。session 是本会话里的临时结论。
   * 文档里的制度、步骤和数字不记，那些继续由知识库检索提供。
   */
  private async classify(question: string, answer: string) {
    const { text } = await tracedGenerateText({
      model: createChatModel(),
      temperature: 0,
      system: [
        '你判断这一轮问答要不要写入长期记忆，并决定写入哪一类。',
        '只输出 JSON：{"items":[{"scope":"fact或session","text":"一句话"}]}。没有要记的内容时输出 {"items":[]}。',
        'fact：用户的身份、偏好、长期约束、跨会话仍然成立的决定。',
        'session：当前会话里才成立的指代对象、临时计划、还没说完的话题。',
        '不要记录寒暄、拒答、检索失败，也不要把知识库文档的正文、步骤和数字抄进来。',
        '每条是一句完整的话，最多 3 条。',
      ].join('\n'),
      prompt: `用户问题：\n${question}\n\n助手回答：\n${answer}`,
    });
    return parseMemoryNotes(text);
  }
}
