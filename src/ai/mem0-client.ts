import { MemoryClient, type Memory } from 'mem0ai';
import { MEMORY_TTL_MS } from './chat-memory.js';
import {
  LONG_MEMORY_LIMIT,
  LONG_MEMORY_TEXT_LIMIT,
  type LongMemory,
  type MemoryNote,
  type MemoryScope,
} from './mem0-memory.js';

/**
 * Mem0 平台客户端的薄封装。
 * 没配 MEM0_API_KEY 时所有方法直接跳过，问答不依赖 Mem0 是否在线。
 * 检索必须放在 filters 里。这个版本的 SDK 不接受顶层 userId。
 * infer 设为 false，避免 Mem0 再抽一次，存储内容以本模块的分类结果为准。
 */
export class Mem0Client {
  private client: MemoryClient | null = null;

  enabled() {
    return Boolean(process.env.MEM0_API_KEY?.trim());
  }

  /** 同时查永久信息和当前会话信息，过期的会话记忆丢掉。 */
  async search(userId: string, sessionId: string, query: string) {
    const client = this.api();
    if (!client) return [];
    const [facts, session] = await Promise.all([
      client.search(query, {
        topK: LONG_MEMORY_LIMIT,
        filters: {
          AND: [{ user_id: userId }, { metadata: { scope: 'fact' } }],
        },
      }),
      client.search(query, {
        topK: LONG_MEMORY_LIMIT,
        filters: { AND: [{ user_id: userId }, { run_id: sessionId }] },
      }),
    ]);
    return unique([
      ...readMemories(facts.results, 'fact'),
      ...readMemories(session.results, 'session'),
    ]);
  }

  /** 按分类写入。会话记忆带到期时间，信息记忆不带。 */
  async add(userId: string, sessionId: string, note: MemoryNote) {
    const client = this.api();
    if (!client) return;
    const expiresAt = sessionExpiryDate();
    await client.add([{ role: 'user', content: note.text }], {
      userId,
      infer: false,
      metadata: {
        scope: note.scope,
        ...(note.scope === 'session' ? { expiresAt } : {}),
      },
      ...(note.scope === 'session'
        ? { runId: sessionId, expirationDate: expiresAt }
        : {}),
    });
  }

  /**
   * 这个会话还在用，就把已有会话记忆的到期时间续到 24 小时后。
   * 一次最多续 20 条。更早的会话记忆到期后由 Mem0 自己不再返回。
   */
  async extendSession(userId: string, sessionId: string) {
    const client = this.api();
    if (!client) return;
    const page = await client.getAll({
      pageSize: 20,
      filters: { AND: [{ user_id: userId }, { run_id: sessionId }] },
    });
    const expiresAt = sessionExpiryDate();
    const ids = (page.results ?? [])
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));
    await Promise.all(
      ids.map((id) => client.update(id, { expirationDate: expiresAt })),
    );
  }

  /** 只删除这个会话的 run。不带 runId 会把该用户的永久信息也删掉。 */
  async forgetSession(userId: string, sessionId: string) {
    const client = this.api();
    if (!client) return;
    await client.deleteAll({ userId, runId: sessionId });
  }

  private api() {
    const apiKey = process.env.MEM0_API_KEY?.trim();
    if (!apiKey) return null;
    if (!this.client) {
      const host = process.env.MEM0_HOST?.trim();
      this.client = new MemoryClient({ apiKey, ...(host ? { host } : {}) });
    }
    return this.client;
  }
}

/** Mem0 的 expiration_date 只收 YYYY-MM-DD，不收带时间的 ISO 字符串。按 24 小时后的日期写入。 */
function sessionExpiryDate() {
  return new Date(Date.now() + MEMORY_TTL_MS).toISOString().slice(0, 10);
}

function readMemories(
  items: Memory[] | undefined,
  fallback: MemoryScope,
): LongMemory[] {
  const now = Date.now();
  const memories: LongMemory[] = [];
  for (const item of items ?? []) {
    const text = typeof item.memory === 'string' ? item.memory.trim() : '';
    if (!item.id || !text) continue;
    const scope = readScope(item.metadata) ?? fallback;
    const expiresAt = readExpiry(item);
    if (expiresAt && Date.parse(expiresAt) <= now) continue;
    memories.push({
      id: item.id,
      scope,
      text: clip(text, LONG_MEMORY_TEXT_LIMIT),
      expiresAt,
    });
  }
  return memories;
}

function readScope(metadata: Memory['metadata']): MemoryScope | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const scope = 'scope' in metadata ? metadata.scope : undefined;
  return scope === 'fact' || scope === 'session' ? scope : null;
}

function readExpiry(item: Memory) {
  if (typeof item.expirationDate === 'string') return item.expirationDate;
  if (!item.metadata || typeof item.metadata !== 'object') return null;
  const expiresAt =
    'expiresAt' in item.metadata ? item.metadata.expiresAt : undefined;
  return typeof expiresAt === 'string' ? expiresAt : null;
}

function unique(items: LongMemory[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });
}

function clip(text: string, max: number) {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join('')}…`;
}
