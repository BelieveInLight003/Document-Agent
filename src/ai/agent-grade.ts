import type { HybridHitView } from './ai.view.js';
import { bochaDisabledReason, bochaEnabled } from './bocha-search.js';
import type { ChatSource } from './chat-step.js';
import { tracedGenerateText } from './langsmith.js';
import { materialHeading } from './prompt.js';
import { createChatModel } from './chat-model.js';

/**
 * 一组检索结果和问题是否同一主题。
 * 只有 sufficient 能进入回答。其余三档都只说明为什么不够，不能当依据。
 */
export type GradeLabel = 'sufficient' | 'partial' | 'irrelevant' | 'empty';

export type GradeDecision = {
  grade: GradeLabel;
  reason: string;
};

export const GRADE_LABEL: Record<GradeLabel, string> = {
  sufficient: '切题且够用',
  partial: '部分相关，信息不足',
  irrelevant: '不切题',
  empty: '没有检索到资料',
};

/** 解析失败时不当成切题，避免把没评估过的资料送进回答。 */
export function parseGrade(raw: string): GradeDecision {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return { grade: 'partial', reason: '没能完成评估' };
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { grade?: unknown; reason?: unknown };
    const grade = parsed.grade;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    if (grade === 'sufficient' || grade === 'partial' || grade === 'irrelevant' || grade === 'empty') {
      return { grade, reason: clip(reason || GRADE_LABEL[grade], 200) };
    }
  } catch {
    // 落到下面的保守结果
  }
  return { grade: 'partial', reason: '没能完成评估' };
}

/** 有资料才调用模型。评估失败按部分相关处理，随后可以改写重查。 */
export async function gradeHits(question: string, items: HybridHitView[]): Promise<GradeDecision> {
  if (items.length === 0) {
    return { grade: 'empty', reason: GRADE_LABEL.empty };
  }
  const passages = items.map((item, index) => `${materialHeading(item, index)}\n${item.content}`).join('\n\n');
  try {
    const { text } = await tracedGenerateText({
      model: createChatModel(),
      temperature: 0,
      system: [
        '你判断检索到的资料能不能回答这个问题。',
        '资料里可能有知识图谱关系，格式是「实体 —关系→ 实体」，和文档切片一样算依据。',
        '资料里也可能有网页摘要。公开信息、新闻和时效性问题可以把网页判为 sufficient。',
        '天气预报、气温和降水可以用来回答是否适合出行或爬山。地点和时间对得上，就判 sufficient。',
        '公司制度、内部流程、餐补、入职和内部数字，只有文档或知识图谱能判 sufficient。公开网页不能单独支撑这些内部事实。',
        '只输出 JSON：{"grade":"sufficient|partial|irrelevant|empty","reason":"一句话原因"}。',
        'sufficient：资料和问题是同一件事，而且写得出答案。',
        'partial：沾边，但缺关键事实，不能单独作答。',
        'irrelevant：主题不同，不能当依据。',
        'empty：资料是空的。',
        '不要回答问题本身。',
      ].join('\n'),
      prompt: `问题：\n${question}\n\n资料：\n${passages}`,
    });
    return parseGrade(text);
  } catch {
    return { grade: 'partial', reason: '评估暂时不可用' };
  }
}

/**
 * 根据原问题、上次检索词和不够的原因，换成更像制度标题的检索词。
 * 失败或结果为空时返回空字符串，调用方停止重查。
 */
export async function rewriteSearchQuery(question: string, query: string, reason: string) {
  try {
    const { text } = await tracedGenerateText({
      model: createChatModel(),
      temperature: 0,
      system: [
        '你把知识库检索词改写成更可能命中制度标题的短语。',
        '只输出检索词本身，不要回答，不要加引号。',
        '保留原问题里的对象，补上标准、制度、流程这类文档用词。',
      ].join('\n'),
      prompt: `原问题：\n${question}\n\n上次检索词：\n${query}\n\n资料不够的原因：\n${reason}`,
    });
    const line = text
      .split('\n')
      .map((item) => item.trim())
      .find((item) => item.length > 0);
    return line ? clip(line.replace(/^["「]|["」]$/g, ''), 80) : '';
  } catch {
    return '';
  }
}

/**
 * 联网结果不切题时，把问句改成搜索引擎更容易命中的短语。
 * 失败或结果为空时返回空字符串，调用方停止重查。
 */
export async function rewriteWebQuery(question: string, query: string, reason: string) {
  try {
    const { text } = await tracedGenerateText({
      model: createChatModel(),
      temperature: 0,
      system: [
        '你把联网问题改写成搜索引擎更容易命中的短语。',
        '只输出检索词本身，不要回答，不要加引号。',
        '保留地点、时间和要查的事实。适不适合、好不好这类判断不要写进检索词，改成能支撑判断的事实，例如天气预报。',
        '如果上次结果是相近但不同的地名，补上所属省市，避免再次搜错地方。',
      ].join('\n'),
      prompt: `原问题：\n${question}\n\n上次检索词：\n${query}\n\n资料不够的原因：\n${reason}`,
    });
    const line = text
      .split('\n')
      .map((item) => item.trim())
      .find((item) => item.length > 0);
    return line ? clip(line.replace(/^["「]|["」]$/g, ''), 80) : '';
  } catch {
    return '';
  }
}

/** WEB_SEARCH_ENABLED 为 true，并且配置了博查密钥，才联网。 */
export function webSearchEnabled() {
  return bochaEnabled();
}

export function webSearchDisabledReason() {
  return bochaDisabledReason();
}

/** 回答里出现过的 [n]。编号从 1 开始，超出资料条数的忽略。 */
export function citedIndexes(answer: string, total: number) {
  const found = new Set<number>();
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const index = Number(match[1]);
    if (index >= 1 && index <= total) found.add(index);
  }
  return [...found].sort((left, right) => left - right);
}

export function citedItems(items: HybridHitView[], answer: string) {
  return citedIndexes(answer, items.length).map((index) => items[index - 1]);
}

/** 来源编号和回答里的 [n] 对齐。同一篇文档被两段引用时保留两条。 */
export function citedSources(items: HybridHitView[], answer: string): ChatSource[] {
  return citedIndexes(answer, items.length).map((index) => {
    const item = items[index - 1];
    return {
      index,
      documentId: item.documentId,
      title: item.title,
      chapter: item.chapter,
      url: item.url,
    };
  });
}

function clip(text: string, max: number) {
  const chars = [...text.trim()];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('');
}
