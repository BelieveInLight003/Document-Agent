import { tracedGenerateText } from './langsmith.js';
import { createChatModel } from './chat-model.js';

/**
 * 一轮提问的意图。工具是否可用由代码决定，模型只负责分类和给出检索词。
 *
 * chat：闲聊，不查知识库。
 * preference：用户本人的偏好和身份，只看长期记忆。
 * knowledge：只查知识库。不够时可以改写后再查一次。
 * web：公开信息或用户明确要求查互联网。用博查检索。
 * knowledge_then_web：先查知识库。没有切题资料时再联网，第一次没有任何资料就不再改写。
 */
export type AgentIntent = 'chat' | 'preference' | 'knowledge' | 'web' | 'knowledge_then_web';

export type RouteDecision = {
  intent: AgentIntent;
  /** 拿去知识库检索的词。闲聊和偏好可以是空字符串。 */
  query: string;
};

const INTENTS: AgentIntent[] = ['chat', 'preference', 'knowledge', 'web', 'knowledge_then_web'];

export const INTENT_LABEL: Record<AgentIntent, string> = {
  chat: '闲聊',
  preference: '个人偏好',
  knowledge: '知识库',
  web: '联网',
  knowledge_then_web: '知识库不足再联网',
};

/** 模型没给出合法意图时按知识库处理，避免漏查规定。 */
export function parseRoute(raw: string, fallbackQuery: string): RouteDecision {
  const parsed = readJson(raw);
  const intent = parsed && typeof parsed.intent === 'string' ? parsed.intent : '';
  const query = parsed && typeof parsed.query === 'string' ? parsed.query.trim() : '';
  if (!INTENTS.includes(intent as AgentIntent)) {
    return { intent: 'knowledge', query: clip(fallbackQuery, 80) };
  }
  return {
    intent: intent as AgentIntent,
    query: clip(query || fallbackQuery, 80),
  };
}

/** 结合上文判断这一问该不该查知识库，并给出检索词。失败时退回知识库意图。 */
export async function routeQuestion(question: string, memory: string, longTerm: string) {
  try {
    const { text } = await tracedGenerateText({
      model: createChatModel(),
      temperature: 0,
      system: [
        '你负责判断用户这一问的意图，并给出知识库检索词。',
        '只输出 JSON：{"intent":"chat|preference|knowledge|web|knowledge_then_web","query":"检索词"}。',
        'chat：问候、感谢、和制度无关的闲聊。query 置空。',
        'preference：在问用户自己的偏好、身份、称呼。query 置空。',
        'knowledge：要查公司制度、流程、文档。query 写成适合检索的短语。',
        'web：公开信息、新闻、天气、实时法规，或用户明确要求查互联网，且不是公司内部规定。query 写成搜索短语。',
        'knowledge_then_web：内部知识库可能没有、允许外部补充的问题。query 仍按知识库检索来写。',
        '公司制度、餐补、入职、内部流程一律是 knowledge，不要因为句子短就当成闲聊或联网。',
      ].join('\n'),
      prompt: [
        memory.trim() ? `对话记忆：\n${memory.trim()}` : '',
        longTerm.trim() ? `长期记忆：\n${longTerm.trim()}` : '',
        `最新问题：\n${question}`,
      ]
        .filter((block) => block.length > 0)
        .join('\n\n'),
    });
    return parseRoute(text, question);
  } catch {
    return { intent: 'knowledge' as const, query: clip(question, 80) };
  }
}

function readJson(raw: string): { intent?: unknown; query?: unknown } | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as { intent?: unknown; query?: unknown };
  } catch {
    return null;
  }
}

function clip(text: string, max: number) {
  const chars = [...text.trim()];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('');
}
