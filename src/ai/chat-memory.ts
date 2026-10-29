/**
 * 会话短期记忆。
 *
 * Redis 里只放两块：更早对话压成的摘要，以及最近几轮原文。
 * 24 小时内重复读写会刷新过期时间，从最后一次使用开始算。
 * 超过 12 条原文时，把靠前的几条并进摘要，最近 8 条留着，避免一条会话把 Redis 撑满。
 * Redis 没有这份记忆时，调用方从 Postgres 取最近 20 条消息再写回 Redis。
 */

/** 从最后一次读写起 24 小时过期。 */
export const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
/** Redis 失效后，从 Postgres 回填的消息条数。 */
export const MEMORY_FALLBACK_LIMIT = 20;
/** 原文超过这个条数就压缩靠前部分。 */
export const MEMORY_COMPRESS_AFTER = 12;
/** 压缩后仍保留的最近原文条数。 */
export const MEMORY_RECENT_LIMIT = 8;
/** 单条写入 Redis 的字数上限。完整回答仍在 Postgres。 */
export const MEMORY_TURN_LIMIT = 1500;

/** 一条记忆。role 只保留问答双方，不存检索步骤。 */
export type MemoryTurn = {
  role: 'user' | 'assistant';
  content: string;
};

/** summary 是更早对话的压缩文本。turns 按时间从旧到新。 */
export type ChatMemory = {
  summary: string;
  turns: MemoryTurn[];
};

export function emptyMemory(): ChatMemory {
  return { summary: '', turns: [] };
}

/** 每个会话一把钥匙。sessionId 用字符串，避免雪花 id 丢精度。 */
export function memoryKey(sessionId: string) {
  return `kh:chat:memory:${sessionId}`;
}

/**
 * 问题是否依赖上文才能懂。
 * 只看指代和明显的追问说法，不因为句子短就改写。
 * 没有上文时调用方应跳过改写。
 */
export function needsRewrite(question: string) {
  return /(这个|那个|这些|那些|这样|那样|这里|那里|这边|那边|它|他|她|它们|他们|她们|其|该文档|上述|刚才|之前|上面|下面|前面|后面|继续|详细说说|展开说说|然后呢|还有呢)/.test(
    question,
  );
}

/** 摘要或最近对话有内容，才值得拿来改写和拼进提示词。 */
export function hasMemory(memory: ChatMemory) {
  return memory.summary.trim().length > 0 || memory.turns.length > 0;
}

/**
 * 拼进回答提示词的记忆文本。
 * 摘要在前，最近原文在后，模型先看到结论再看到原话。
 */
export function formatMemory(memory: ChatMemory) {
  const blocks: string[] = [];
  if (memory.summary.trim()) {
    blocks.push(`更早的对话摘要：\n${memory.summary.trim()}`);
  }
  if (memory.turns.length > 0) {
    const lines = memory.turns.map(
      (turn) => `${turn.role === 'user' ? '用户' : '助手'}：${turn.content}`,
    );
    blocks.push(`最近对话：\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

/** 追加这一轮问答。内容先截断，避免单条回答占满记忆。 */
export function appendTurn(memory: ChatMemory, question: string, answer: string): ChatMemory {
  return {
    summary: memory.summary,
    turns: [
      ...memory.turns,
      { role: 'user', content: clip(question, MEMORY_TURN_LIMIT) },
      { role: 'assistant', content: clip(answer, MEMORY_TURN_LIMIT) },
    ],
  };
}

/**
 * 原文太长时，拆出靠前部分去摘要，最近几条留下。
 * 没超过门槛时返回 null，调用方不用请求模型。
 */
export function splitForSummary(memory: ChatMemory) {
  if (memory.turns.length <= MEMORY_COMPRESS_AFTER) {
    return null;
  }
  return {
    head: memory.turns.slice(0, -MEMORY_RECENT_LIMIT),
    recent: memory.turns.slice(-MEMORY_RECENT_LIMIT),
  };
}

/** 把模型输出收成一行问题。空结果表示改写失败，调用方继续用原问题。 */
export function cleanRewrite(text: string) {
  const line = text
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (!line) {
    return '';
  }
  return clip(line.replace(/^["「]|["」]$/g, ''), 500);
}

function clip(text: string, max: number) {
  const chars = [...text.trim()];
  if (chars.length <= max) {
    return chars.join('');
  }
  return `${chars.slice(0, max).join('')}…`;
}
