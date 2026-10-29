import type { HybridHitView } from './ai.view.js';

/** 资料不足时的唯一回复。检索为空时直接返回，不再调用模型。 */
export const UNANSWERABLE = '根据现有资料无法回答这个问题。';

const SYSTEM_PROMPT = [
  '你是知识库问答助手。文档里的事实只根据「资料」回答，用户本人的信息可以结合「长期记忆」。',
  '资料和长期记忆里都没有写出的事实，不要用常识、推测或别的来源补上。',
  `如果两边都不足以回答，只输出这一句，不要加别的字：${UNANSWERABLE}`,
  '不要编造人名、数字、时间、步骤和文档。',
  '对话记忆只用来理解指代和上文，不能当作事实。',
  '长期记忆可以用来回答用户本人的偏好、身份和已经确认的长期信息，不能用来补充文档里没有的制度、步骤和数字。',
  '文档事实和长期记忆冲突时，以资料为准。',
  '能够回答时，用中文直接作答。适合对照的内容用 Markdown 表格，标题用 Markdown 标题。',
  '用到文档时，最后一行以「依据：」开头，列出文档标题。只用了长期记忆时，最后一行写「依据：长期记忆」。',
].join('\n');

/**
 * memory 是 Redis 里的摘要和最近对话。
 * longTerm 是 Mem0 里检索到的长期信息和本会话信息。两边都可以是空字符串。
 */
export function answerPrompt(
  question: string,
  items: HybridHitView[],
  memory = '',
  longTerm = '',
) {
  const passages = items
    .map(
      (item, index) =>
        `[${index + 1}] 文档《${item.title}》\n${item.content}`,
    )
    .join('\n\n');
  const memoryBlock = memory.trim() ? `对话记忆：\n${memory.trim()}\n\n` : '';
  const longTermBlock = longTerm.trim() ? `长期记忆：\n${longTerm.trim()}\n\n` : '';
  const material = passages || '无';
  return {
    instructions: SYSTEM_PROMPT,
    prompt: `${memoryBlock}${longTermBlock}资料：\n${material}\n\n问题：\n${question}`,
  };
}

export function chatMessages(question: string, items: HybridHitView[]) {
  const { instructions, prompt } = answerPrompt(question, items);
  return [
    { role: 'system' as const, content: instructions },
    { role: 'user' as const, content: prompt },
  ];
}
