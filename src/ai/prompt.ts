import type { HybridHitView } from './ai.view.js';

/** 资料不足时的唯一回复。检索为空时直接返回，不再调用模型。 */
export const UNANSWERABLE = '根据现有资料无法回答这个问题。';

const SYSTEM_PROMPT = [
  '你是知识库问答助手。只根据用户消息里的「资料」回答「问题」。',
  '资料里没有写出的事实，不要用常识、推测或别的来源补上。',
  `如果资料不足以回答，只输出这一句，不要加别的字：${UNANSWERABLE}`,
  '不要编造人名、数字、时间、步骤和文档。',
  '能够回答时，用中文直接作答。适合对照的内容用 Markdown 表格，标题用 Markdown 标题。',
  '最后一行以「依据：」开头，列出用到的文档标题。',
].join('\n');

export function answerPrompt(question: string, items: HybridHitView[]) {
  const passages = items
    .map(
      (item, index) =>
        `[${index + 1}] 文档《${item.title}》\n${item.content}`,
    )
    .join('\n\n');
  return {
    instructions: SYSTEM_PROMPT,
    prompt: `资料：\n${passages}\n\n问题：\n${question}`,
  };
}

export function chatMessages(question: string, items: HybridHitView[]) {
  const { instructions, prompt } = answerPrompt(question, items);
  return [
    { role: 'system' as const, content: instructions },
    { role: 'user' as const, content: prompt },
  ];
}
