import { UNANSWERABLE } from './prompt.js';

/**
 * 长期记忆的两条线。
 *
 * fact：用户身份、偏好、长期决定。跨会话保留，删除会话时不动。
 * session：只在当前会话里成立的指代、临时结论、没说完的话题。
 * 会话记忆写入时带 24 小时到期时间，之后每次仍在这个会话里回答，都会把到期时间重新拨到 24 小时后。
 * 删除会话时立刻清掉该会话的 session 记忆。
 *
 * 知识库正文不写进 Mem0。文档事实只走 RAG。
 */

export const LONG_MEMORY_LIMIT = 5;
export const LONG_MEMORY_TEXT_LIMIT = 300;
export const LONG_MEMORY_NOTE_LIMIT = 3;

export type MemoryScope = 'fact' | 'session';

/** 从 Mem0 检索回来的一条记忆。 */
export type LongMemory = {
  id: string;
  scope: MemoryScope;
  text: string;
  /** 会话记忆的到期时间。信息记忆为空。 */
  expiresAt: string | null;
};

/** 分类器决定要写入的一条记忆。 */
export type MemoryNote = {
  scope: MemoryScope;
  text: string;
};

/** 拼进改写提示词和回答提示词。信息在前，本会话信息在后。 */
export function formatLongTerm(items: LongMemory[]) {
  const facts = items.filter((item) => item.scope === 'fact');
  const session = items.filter((item) => item.scope === 'session');
  const blocks: string[] = [];
  if (facts.length > 0) {
    blocks.push(`长期信息：\n${facts.map((item) => `- ${item.text}`).join('\n')}`);
  }
  if (session.length > 0) {
    blocks.push(`本会话信息：\n${session.map((item) => `- ${item.text}`).join('\n')}`);
  }
  return blocks.join('\n\n');
}

/** 拒答、中断和只表示检索条数的回复没有可沉淀的信息。 */
export function canRetain(answer: string) {
  const text = answer.trim();
  if (!text) return false;
  if (text.startsWith(UNANSWERABLE)) return false;
  if (text.startsWith('回答已中断')) return false;
  if (text.startsWith('对话暂时不可用')) return false;
  if (text.startsWith('混合检索暂时不可用')) return false;
  if (text.startsWith('没有检索到相关资料')) return false;
  if (/^混合检索 \d+ 条$/.test(text)) return false;
  return true;
}

/**
 * 解析分类器输出。格式固定为 {"items":[{"scope":"fact"|"session","text":"..."}]}。
 * 解析失败、范围不对或正文为空都当成不存储。最多留下 3 条。
 */
export function parseMemoryNotes(raw: string): MemoryNote[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || !('items' in parsed)) return [];
  const items = parsed.items;
  if (!Array.isArray(items)) return [];
  const notes: MemoryNote[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const scope = 'scope' in item ? item.scope : '';
    const text = 'text' in item && typeof item.text === 'string' ? item.text.trim() : '';
    if ((scope !== 'fact' && scope !== 'session') || !text) continue;
    notes.push({ scope, text: clip(text, LONG_MEMORY_TEXT_LIMIT) });
    if (notes.length >= LONG_MEMORY_NOTE_LIMIT) break;
  }
  return notes;
}

function clip(text: string, max: number) {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join('')}…`;
}
