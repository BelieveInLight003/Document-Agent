import { tracedGenerateText } from '../langsmith.js';
import { createChatModel } from '../chat-model.js';
import type { HybridHitView } from '../ai.view.js';
import { materialHeading } from '../prompt.js';
import type { MetricScore } from './eval-case.js';

/**
 * 生成层四项。裁判是现有对话模型，温度 0，只收 JSON。
 * 解析失败记成未评，不记 0，避免一次接口错误把平均分拉低。
 *
 * 忠实度只看「送进回答的资料」和回答，不看标准要点，防止标准答案泄露给裁判。
 * 相关性只看问题和回答。
 * 完整性拿回答去对标准要点，意思相同就算覆盖。
 * 利用率只看已经检索到的必需切片，没检索到的归 Recall，不在这里扣分。
 */

const JSON_ONLY = '只输出一个 JSON 对象，不要加别的字。';

export async function judgeFaithfulness(answer: string, items: HybridHitView[]): Promise<MetricScore> {
  const passages = items.length
    ? items.map((item, index) => `${materialHeading(item, index)}\n${item.content}`).join('\n\n')
    : '无';
  const parsed = await askJudge(
    [
      '你检查回答里的事实是不是都来自给定资料。',
      '资料里没有的人名、数字、时间、步骤，算没有依据。',
      '资料为空时，回答只要没有写出具体制度、数字或步骤，就算通过。',
      JSON_ONLY,
      '格式：{"pass": true, "reason": "一句原因"}',
    ].join('\n'),
    `资料：\n${passages}\n\n回答：\n${clip(answer, 2000)}`,
  );
  return passScore(parsed);
}

export async function judgeRelevancy(question: string, answer: string): Promise<MetricScore> {
  const parsed = await askJudge(
    [
      '你判断回答有没有对着用户的问题作答。',
      '跑题、答成另一件事，算不通过。',
      '打招呼得到简短回应，算通过。',
      JSON_ONLY,
      '格式：{"pass": true, "reason": "一句原因"}',
    ].join('\n'),
    `问题：\n${question}\n\n回答：\n${clip(answer, 2000)}`,
  );
  return passScore(parsed);
}

export async function judgeCompleteness(question: string, answer: string, keyPoints: string[]): Promise<MetricScore> {
  const parsed = await askJudge(
    [
      '你逐条判断回答覆盖了哪些标准要点。',
      '意思相同即可，不必逐字相同。多写的内容不要算进 covered。',
      JSON_ONLY,
      '格式：{"covered": ["被覆盖的要点原文"], "reason": "一句原因"}',
    ].join('\n'),
    `问题：\n${question}\n\n标准要点：\n${keyPoints.map((point) => `- ${point}`).join('\n')}\n\n回答：\n${clip(answer, 2000)}`,
  );
  if (!parsed) return unevaluated('裁判没有返回覆盖了哪些要点');
  const covered = parsed.covered;
  if (!Array.isArray(covered)) {
    return unevaluated('裁判没有返回覆盖了哪些要点');
  }
  const hit = keyPoints.filter((point) =>
    covered.some((item: unknown) => typeof item === 'string' && item.trim() === point),
  );
  return {
    value: hit.length / keyPoints.length,
    state: 'scored',
    reason: typeof parsed.reason === 'string' ? parsed.reason : `覆盖 ${hit.length}/${keyPoints.length}`,
  };
}

export async function judgeUtilization(
  answer: string,
  passages: Array<{ id: string; text: string }>,
): Promise<MetricScore> {
  const parsed = await askJudge(
    [
      '你判断回答用上了哪些资料片段里的事实。',
      '片段里的事实出现在回答中，才把该片段的 id 放进 used。',
      '只是标题相同、事实没写出来，不算用上。',
      JSON_ONLY,
      '格式：{"used": ["片段id"], "reason": "一句原因"}',
    ].join('\n'),
    `资料片段：\n${passages.map((item) => `id=${item.id}\n${item.text}`).join('\n\n')}\n\n回答：\n${clip(answer, 2000)}`,
  );
  if (!parsed) return unevaluated('裁判没有返回用了哪些片段');
  const usedIds = parsed.used;
  if (!Array.isArray(usedIds)) {
    return unevaluated('裁判没有返回用了哪些片段');
  }
  const used = passages.filter((item) =>
    usedIds.some((id: unknown) => typeof id === 'string' && id.trim() === item.id),
  );
  return {
    value: used.length / passages.length,
    state: 'scored',
    reason: typeof parsed.reason === 'string' ? parsed.reason : `用上 ${used.length}/${passages.length}`,
  };
}

export function skipped(reason: string): MetricScore {
  return { value: null, state: 'skipped', reason };
}

export function scored(value: number, reason: string): MetricScore {
  return { value, state: 'scored', reason };
}

function passScore(parsed: { pass?: unknown; reason?: unknown } | null): MetricScore {
  if (!parsed || typeof parsed.pass !== 'boolean') {
    return unevaluated('裁判没有返回是否通过');
  }
  return {
    value: parsed.pass ? 1 : 0,
    state: 'scored',
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

function unevaluated(reason: string): MetricScore {
  return { value: null, state: 'unevaluated', reason };
}

async function askJudge(system: string, prompt: string) {
  try {
    const { text } = await tracedGenerateText({
      model: createChatModel(),
      temperature: 0,
      system,
      prompt,
    });
    return readJson(text);
  } catch {
    return null;
  }
}

function readJson(raw: string): { pass?: unknown; reason?: unknown; covered?: unknown; used?: unknown } | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      pass?: unknown;
      reason?: unknown;
      covered?: unknown;
      used?: unknown;
    };
    return parsed;
  } catch {
    return null;
  }
}

function clip(text: string, max: number) {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max).join('');
}
