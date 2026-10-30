import type { HybridHitView } from './ai.view.js';
import type { ChatStep } from './chat-step.js';
import type { ChatTrace } from './langsmith.js';
import { GRADE_LABEL, gradeHits, rewriteSearchQuery, rewriteWebQuery, webSearchDisabledReason, webSearchEnabled } from './agent-grade.js';
import { INTENT_LABEL, routeQuestion, type AgentIntent } from './agent-route.js';

/**
 * 知识库问答的固定决策链。
 *
 * 知识库和「知识库不足再联网」同时挂文档检索和图谱检索。
 * 每一轮先查文档，再查图谱，然后一起评估。图谱只作补充，一轮里最多查两次。
 * 不够切题时改写检索词，文档和图谱用新词再查一次。改写最多一次。
 * 知识库不足再联网，以及开关打开时的知识库意图：第一次没有任何资料就直接联网。
 * 有资料但不切题时，先改写重查一次；仍然不够，并且开关打开，再联网。
 * 联网意图不查知识库，直接用博查。结果不切题时改写检索词再查一次，改写会显示在思考步骤里。
 * 公司制度已经能由文档或图谱回答时，不再联网。
 */

export type AgentOutcome = 'answer' | 'chat' | 'preference' | 'refuse' | 'unavailable' | 'aborted';

export type AgentLoopResult = {
  intent: AgentIntent;
  query: string;
  /** 只有评估为切题且够用的那一轮资料。不够时是空数组。 */
  items: HybridHitView[];
  outcome: AgentOutcome;
  /** 拒答原因。回答时不使用。 */
  refuseReason?: 'knowledge' | 'web-insufficient' | 'web-unavailable' | 'web-off';
};

const TOOL_BUDGET = 3;

export async function runAgentLoop(input: {
  question: string;
  memory: string;
  longTerm: string;
  limit: number;
  signal: AbortSignal;
  trace: ChatTrace;
  retrieve: (query: string, limit: number) => Promise<HybridHitView[]>;
  /** 知识图谱检索。失败时应抛出，由决策链记成「图谱暂时不可用」并继续用文档结果。 */
  retrieveGraph: (query: string, limit: number) => Promise<HybridHitView[]>;
  /** 博查联网检索。失败时应抛出，由决策链记成「联网暂时不可用」。 */
  retrieveWeb: (query: string, limit: number) => Promise<HybridHitView[]>;
  onStep: (step: ChatStep) => void;
}): Promise<AgentLoopResult> {
  const route = await input.trace.span(
    '意图路由',
    'chain',
    { question: input.question },
    () => routeQuestion(input.question, input.memory, input.longTerm),
    (decision) => decision,
  );
  input.onStep({
    id: 'intent',
    kind: 'fold',
    title: `意图：${INTENT_LABEL[route.intent]}`,
    detail: route.query ? `检索词：${route.query}` : '这一问不查知识库。',
    status: 'done',
  });
  if (input.signal.aborted) {
    return { intent: route.intent, query: route.query, items: [], outcome: 'aborted' };
  }
  if (route.intent === 'chat' || route.intent === 'preference') {
    return { intent: route.intent, query: route.query, items: [], outcome: route.intent };
  }
  if (route.intent === 'web') {
    return searchWeb(input, route.intent);
  }

  let calls = 0;
  const first = await searchRound(input, route.query, 'search', 'graph');
  if (first.outcome) {
    return { intent: route.intent, query: route.query, items: [], outcome: first.outcome };
  }
  calls += 1;
  const graded = await grade(input, input.question, route.query, first.items, 'grade');
  if (graded.grade === 'sufficient') {
    return { intent: route.intent, query: route.query, items: first.items, outcome: 'answer' };
  }
  // 第一次没有资料：开关打开就联网，不再改写。
  if (first.items.length === 0 && shouldSearchWeb(route.intent)) {
    return searchWeb(input, route.intent);
  }
  if (calls >= TOOL_BUDGET || input.signal.aborted) {
    return { intent: route.intent, query: route.query, items: [], outcome: input.signal.aborted ? 'aborted' : 'refuse' };
  }

  const rewritten = await input.trace.span(
    '检索改写',
    'chain',
    { question: input.question, query: route.query, reason: graded.reason },
    () => rewriteSearchQuery(input.question, route.query, graded.reason),
    (query) => ({ query }),
  );
  calls += 1;
  if (!rewritten || rewritten === route.query) {
    input.onStep({
      id: 'rewrite',
      kind: 'fold',
      title: '检索词不需要再改',
      detail: graded.reason,
      status: 'done',
    });
    return whenKnowledgeShort(input, route.intent, route.query);
  }
  input.onStep({
    id: 'rewrite',
    kind: 'fold',
    title: '改写检索词',
    detail: `改为：${rewritten}`,
    status: 'done',
  });
  if (calls >= TOOL_BUDGET || input.signal.aborted) {
    return { intent: route.intent, query: rewritten, items: [], outcome: input.signal.aborted ? 'aborted' : 'refuse' };
  }

  const second = await searchRound(input, rewritten, 'search-2', 'graph-2');
  if (second.outcome) {
    return { intent: route.intent, query: rewritten, items: [], outcome: second.outcome };
  }
  const gradedAgain = await grade(input, input.question, rewritten, second.items, 'grade-2');
  if (gradedAgain.grade === 'sufficient') {
    return { intent: route.intent, query: rewritten, items: second.items, outcome: 'answer' };
  }
  return whenKnowledgeShort(input, route.intent, rewritten);
}

function whenKnowledgeShort(
  input: {
    question: string;
    limit: number;
    signal: AbortSignal;
    trace: ChatTrace;
    retrieveWeb: (query: string, limit: number) => Promise<HybridHitView[]>;
    onStep: (step: ChatStep) => void;
  },
  intent: AgentIntent,
  query: string,
) {
  if (shouldSearchWeb(intent)) return searchWeb(input, intent);
  return { intent, query, items: [], outcome: 'refuse' as const, refuseReason: 'knowledge' as const };
}

/** 开关打开时，知识库不够也联网。知识库不足再联网即使关着也会走到联网步骤并说明原因。 */
function shouldSearchWeb(intent: AgentIntent) {
  if (intent === 'web' || intent === 'knowledge_then_web') return true;
  return intent === 'knowledge' && webSearchEnabled();
}

async function searchWeb(
  input: {
    question: string;
    limit: number;
    signal: AbortSignal;
    trace: ChatTrace;
    retrieveWeb: (query: string, limit: number) => Promise<HybridHitView[]>;
    onStep: (step: ChatStep) => void;
  },
  intent: AgentIntent,
): Promise<AgentLoopResult> {
  const query = clip(input.question, 200);
  if (!webSearchEnabled()) {
    input.onStep({
      id: 'web',
      kind: 'fold',
      title: '联网检索',
      detail: webSearchDisabledReason(),
      status: 'done',
    });
    return { intent, query, items: [], outcome: 'refuse', refuseReason: 'web-off' };
  }
  if (input.signal.aborted) return { intent, query, items: [], outcome: 'aborted' };
  input.onStep({
    id: 'web',
    kind: 'action',
    title: `我将联网检索「${clip(query, 36)}」。`,
    status: 'running',
  });
  let items: HybridHitView[] = [];
  try {
    items = await input.retrieveWeb(query, input.limit);
  } catch {
    if (input.signal.aborted) return { intent, query, items: [], outcome: 'aborted' };
    input.onStep({
      id: 'web',
      kind: 'action',
      title: `我将联网检索「${clip(query, 36)}」。`,
      detail: '联网暂时不可用。',
      status: 'done',
    });
    return { intent, query, items: [], outcome: 'refuse', refuseReason: 'web-unavailable' };
  }
  input.onStep({
    id: 'web',
    kind: 'action',
    title: `我将联网检索「${clip(query, 36)}」。`,
    detail: `检索到 ${items.length} 条。`,
    status: 'done',
  });
  if (input.signal.aborted) return { intent, query, items: [], outcome: 'aborted' };
  const graded = await grade(input, input.question, query, items, 'web-grade');
  if (graded.grade === 'sufficient') {
    return { intent, query, items, outcome: 'answer' };
  }
  if (input.signal.aborted) return { intent, query, items: [], outcome: 'aborted' };

  const titles = items
    .slice(0, 4)
    .map((item) => item.title)
    .filter((title) => title.length > 0)
    .join('、');
  const reason = titles ? `${graded.reason}。已检索到：${titles}` : graded.reason;
  const rewritten = await input.trace.span(
    '检索改写',
    'chain',
    { question: input.question, query, reason },
    () => rewriteWebQuery(input.question, query, reason),
    (value) => ({ query: value }),
  );
  if (!rewritten || rewritten === query) {
    input.onStep({
      id: 'web-rewrite',
      kind: 'fold',
      title: '检索词不需要再改',
      detail: graded.reason,
      status: 'done',
    });
    return { intent, query, items: [], outcome: 'refuse', refuseReason: 'web-insufficient' };
  }
  input.onStep({
    id: 'web-rewrite',
    kind: 'fold',
    title: `改写检索词为「${rewritten}」。`,
    detail: graded.reason,
    status: 'done',
  });
  if (input.signal.aborted) return { intent, query: rewritten, items: [], outcome: 'aborted' };

  const again = await fetchWeb(input, rewritten, 'web-2');
  if (again.outcome) {
    return { intent, query: rewritten, items: [], outcome: again.outcome === 'aborted' ? 'aborted' : 'refuse', refuseReason: again.outcome === 'aborted' ? undefined : 'web-unavailable' };
  }
  const gradedAgain = await grade(input, input.question, rewritten, again.items, 'web-grade-2');
  if (gradedAgain.grade === 'sufficient') {
    return { intent, query: rewritten, items: again.items, outcome: 'answer' };
  }
  return { intent, query: rewritten, items: [], outcome: 'refuse', refuseReason: 'web-insufficient' };
}

async function fetchWeb(
  input: {
    limit: number;
    signal: AbortSignal;
    retrieveWeb: (query: string, limit: number) => Promise<HybridHitView[]>;
    onStep: (step: ChatStep) => void;
  },
  query: string,
  stepId: string,
): Promise<{ items: HybridHitView[]; outcome?: 'aborted' | 'unavailable' }> {
  const title = `我将联网检索「${clip(query, 36)}」。`;
  if (input.signal.aborted) return { items: [], outcome: 'aborted' };
  input.onStep({ id: stepId, kind: 'action', title, status: 'running' });
  try {
    const items = await input.retrieveWeb(query, input.limit);
    input.onStep({ id: stepId, kind: 'action', title, detail: `检索到 ${items.length} 条。`, status: 'done' });
    if (input.signal.aborted) return { items: [], outcome: 'aborted' };
    return { items };
  } catch {
    if (input.signal.aborted) return { items: [], outcome: 'aborted' };
    input.onStep({ id: stepId, kind: 'action', title, detail: '联网暂时不可用。', status: 'done' });
    return { items: [], outcome: 'unavailable' };
  }
}

function clip(text: string, max: number) {
  const chars = [...text.trim()];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('');
}

async function searchRound(
  input: {
    limit: number;
    signal: AbortSignal;
    retrieve: (query: string, limit: number) => Promise<HybridHitView[]>;
    retrieveGraph: (query: string, limit: number) => Promise<HybridHitView[]>;
    onStep: (step: ChatStep) => void;
  },
  query: string,
  docStepId: string,
  graphStepId: string,
): Promise<{ items: HybridHitView[]; outcome?: 'unavailable' | 'aborted' }> {
  if (input.signal.aborted) return { items: [], outcome: 'aborted' };
  input.onStep({
    id: docStepId,
    kind: 'action',
    title: `我将在知识库中检索「${query}」。`,
    status: 'running',
  });
  input.onStep({
    id: graphStepId,
    kind: 'action',
    title: `我将在知识图谱中检索「${query}」。`,
    status: 'running',
  });
  const [docs, graph] = await Promise.all([
    readSearch(input.retrieve(query, input.limit)),
    readSearch(input.retrieveGraph(query, input.limit)),
  ]);
  input.onStep({
    id: docStepId,
    kind: 'action',
    title: `我将在知识库中检索「${query}」。`,
    detail: docs.failed ? '知识库暂时不可用。' : `检索到 ${docs.items.length} 条。`,
    status: 'done',
  });
  input.onStep({
    id: graphStepId,
    kind: 'action',
    title: `我将在知识图谱中检索「${query}」。`,
    detail: graph.failed ? '图谱暂时不可用。' : `检索到 ${graph.items.length} 条。`,
    status: 'done',
  });
  if (input.signal.aborted) return { items: [], outcome: 'aborted' };
  if (docs.failed && graph.failed) return { items: [], outcome: 'unavailable' };
  return { items: [...docs.items, ...graph.items] };
}

function readSearch(task: Promise<HybridHitView[]>) {
  return task.then(
    (items) => ({ items, failed: false }),
    () => ({ items: [] as HybridHitView[], failed: true }),
  );
}

async function grade(
  input: {
    trace: ChatTrace;
    onStep: (step: ChatStep) => void;
  },
  question: string,
  query: string,
  items: HybridHitView[],
  stepId: string,
) {
  const decision =
    items.length === 0
      ? { grade: 'empty' as const, reason: GRADE_LABEL.empty }
      : await input.trace.span(
          '切题评估',
          'chain',
          { question, query, count: items.length },
          () => gradeHits(question, items),
          (value) => value,
        );
  input.onStep({
    id: stepId,
    kind: 'fold',
    title: `评估：${GRADE_LABEL[decision.grade]}`,
    detail: decision.reason,
    status: 'done',
  });
  return decision;
}
