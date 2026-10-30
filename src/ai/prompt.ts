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
  '网页资料只用来回答公开信息和时效性问题，不能改写成公司内部制度、流程和数字。',
  '文档或知识图谱与网页冲突时，公司内部事实以文档和知识图谱为准。',
  '能够回答时，用中文直接作答。适合对照的内容用 Markdown 表格，标题用 Markdown 标题。',
  '引用了资料时，在对应句子末尾标出编号，例如 [1]。',
  '最后一行以「依据：」开头，只列出实际用到的编号和文档标题，格式如：[1]《标题》。没有用到的资料不要写。',
  '只用了长期记忆、没有用到文档时，最后一行写「依据：长期记忆」。',
].join('\n');

/**
 * 资料标题。网页、图谱和文档切片用不同前缀，评估和回答共用这一套编号。
 */
export function materialHeading(item: HybridHitView, index: number) {
  const number = index + 1;
  if (item.channels.includes('web')) return `[${number}] 网页《${item.title}》`;
  if (item.channels.includes('graph')) return `[${number}] 知识图谱（文档《${item.title}》）`;
  return `[${number}] 文档《${item.title}》`;
}

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
    .map((item, index) => `${materialHeading(item, index)}\n${item.content}`)
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

/** 闲聊不查知识库，也不许编造制度。 */
export function chatPrompt(question: string) {
  return {
    instructions: [
      '你在进行简短的日常对话。',
      '不要编造公司制度、步骤、数字和文档内容。',
      '如果用户其实在问知识库里的规定，请说明需要按知识库检索，不要凭空作答。',
      '用一两句中文回答。',
    ].join('\n'),
    prompt: question,
  };
}

/** 个人偏好只看记忆。记忆里没有的内容不能补。 */
export function preferencePrompt(question: string, memory: string, longTerm: string) {
  const memoryBlock = memory.trim() ? `对话记忆：\n${memory.trim()}\n\n` : '';
  const longTermBlock = longTerm.trim() ? `长期记忆：\n${longTerm.trim()}\n\n` : '长期记忆：\n无\n\n';
  return {
    instructions: [
      '你在回答用户本人的偏好、身份和已经确认的长期信息。',
      '只根据「长期记忆」和「对话记忆」。',
      '记忆里没有写出的内容，不要编造，也不能用它回答公司制度。',
      `如果记忆不足以回答，只输出这一句，不要加别的字：${UNANSWERABLE}`,
      '能够回答时，最后一行写「依据：长期记忆」。',
    ].join('\n'),
    prompt: `${memoryBlock}${longTermBlock}问题：\n${question}`,
  };
}
