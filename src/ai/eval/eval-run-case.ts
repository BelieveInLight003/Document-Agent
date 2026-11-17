import type { DocumentViewer } from '../../document/document-access.js';
import { RoleCode } from '../../user/role-code.js';
import type { AgentLoopResult } from '../agent-loop.js';
import { runAgentLoop } from '../agent-loop.js';
import type { HybridHitView } from '../ai.view.js';
import { AiService } from '../ai.service.js';
import type { ChatStep } from '../chat-step.js';
import { promptOf, refuseCopy } from '../chat-stream.js';
import { graphKeyword, graphPassages } from '../graph-passages.js';
import { GraphService } from '../../graph/graph.service.js';
import { hitTrace, startChatTrace, tracedGenerateText } from '../langsmith.js';
import { createChatModel } from '../chat-model.js';
import { UNANSWERABLE } from '../prompt.js';
import { AgentRuntime } from '../agent-runtime.js';
import { searchBocha } from '../bocha-search.js';
import type { CaseReport, EvalCase, MetricScore } from './eval-case.js';
import { resolveGold } from './eval-gold.js';
import {
  judgeCompleteness,
  judgeFaithfulness,
  judgeRelevancy,
  judgeUtilization,
  scored,
  skipped,
} from './eval-judge.js';
import { countMatched, EVAL_K, scoreRetrieval } from './eval-metrics.js';

/**
 * 跑一道题，顺序固定，方便对照线上链路：
 * 1. 用原问题做一次文档检索，只取前 5 条，算出 Recall / Precision / MRR / Hit。
 *    这一步不用意图模型改写后的词，所以检索分不依赖大模型。
 * 2. 再走和聊天相同的决策链：意图、文档、图谱、切题、改写、联网。
 *    记忆是空的，不读不写 Redis 和 Mem0，也不写会话。
 * 3. 用同一套提示词生成回答。该拒答时不调用模型。
 * 4. 四项生成指标分开裁判。链路中断时这四项留空。
 */

const viewer: DocumentViewer = {
  userId: 'eval',
  roles: [RoleCode.ADMIN],
};

const INFRA_ANSWER = '文档和图谱都暂时不可用，请稍后再试。';

export async function runEvalCase(
  item: EvalCase,
  aiService: AiService,
  graphService: GraphService,
): Promise<CaseReport> {
  const started = Date.now();
  const runtime = new AgentRuntime(undefined, 180_000);
  return runtime.run(async () => {
    const caseViewer = item.viewer ?? viewer;
    const trace = startChatTrace(
      '评测',
      { question: item.question, caseId: item.id },
      { sessionId: item.id, userId: 'eval' },
    );
    const report = emptyReport(item);
    try {
      const resolved = await resolveGold(item.gold);
      const missing = resolved.filter((label) => label.how === 'missing');
      const labels =
        item.gold.length > 0 && missing.length === 0
          ? resolved.map((label) => ({
              chunkId: label.resolvedChunkId,
              documentId: label.documentId,
            }))
          : [];
      const rematched = resolved.filter(
        (label) => label.how === 'mustContain',
      ).length;

      if (item.gold.length === 0) {
        report.retrievalNote = '这题没有必需切片，不评检索。';
      } else if (missing.length > 0) {
        report.retrievalNote = `标注没对上当前索引：${missing.map((label) => label.mustContain).join('、')}。请更新数据集。`;
      } else {
        const found = await trace.span(
          '评测检索',
          'retriever',
          { question: item.question, limit: EVAL_K },
          () =>
            aiService.retrieve(caseViewer, {
              question: item.question,
              limit: EVAL_K,
            }),
          (result) => hitTrace(result.items),
        );
        report.retrieval = scoreRetrieval(found.items, labels);
        report.retrievalNote =
          rematched > 0
            ? `有 ${rematched} 条切片 id 已变，改用正文里的标记重新对上。`
            : '按标注的切片 id 计分。';
      }

      const abort = new AbortController();
      const steps: ChatStep[] = [];
      const loop = await runAgentLoop({
        question: item.question,
        memory: item.memory ?? '',
        longTerm: item.longTerm ?? '',
        limit: EVAL_K,
        signal: abort.signal,
        trace,
        retrieve: (query, size) =>
          trace.span(
            '文档检索',
            'retriever',
            { query, limit: size },
            () => retrieveDocs(aiService, query, size, caseViewer),
            hitTrace,
          ),
        retrieveGraph: (query, size) =>
          trace.span(
            '图谱检索',
            'retriever',
            { query, limit: size },
            () => retrieveGraph(graphService, query, size, caseViewer),
            hitTrace,
          ),
        retrieveWeb: (query, size) =>
          trace.span(
            '联网检索',
            'retriever',
            { query, limit: size },
            () => searchBocha(query, size, abort.signal),
            hitTrace,
          ),
        onStep: (step) => {
          const index = steps.findIndex((current) => current.id === step.id);
          if (index >= 0) steps[index] = step;
          else steps.push(step);
        },
      });
      report.actualIntent = loop.intent;
      report.intentMatched = loop.intent === item.intent;
      report.usedWeb = steps.some(
        (step) => step.id === 'web' || step.id === 'web-2',
      );

      const produced = await produceAnswer(item, loop, trace);
      report.answer = produced.answer;
      report.refused = produced.answer.trim() === UNANSWERABLE;
      if (produced.infra) {
        report.status = 'failed';
        report.error = '检索、评估或模型未正常完成';
      }
      if (labels.length > 0 && report.retrieval) {
        report.handed = {
          matched: countMatched(produced.handed, labels),
          required: labels.length,
        };
      }
      Object.assign(report, await gradeAnswer(item, produced, labels, trace));
      return report;
    } catch (error) {
      report.status = 'failed';
      report.error = error instanceof Error ? error.message : String(error);
      report.faithfulness = skipped('这题中途失败，生成指标不记入平均分。');
      report.relevancy = skipped('这题中途失败，生成指标不记入平均分。');
      report.completeness = skipped('这题中途失败，生成指标不记入平均分。');
      report.utilization = skipped('这题中途失败，生成指标不记入平均分。');
      return report;
    } finally {
      report.durationMs = Date.now() - started;
      report.calls = runtime.usage();
      await trace.end({
        caseId: item.id,
        recall: report.retrieval?.recall ?? null,
        faithfulness: report.faithfulness.value,
        answer: report.answer,
        error: report.error,
      });
    }
  });
}

async function retrieveDocs(
  aiService: AiService,
  query: string,
  size: number,
  caseViewer: DocumentViewer,
) {
  const result = await aiService.retrieve(caseViewer, {
    question: query,
    limit: size,
  });
  return result.items;
}

/** 和会话里的图谱工具一样：先用整句，没有语义关系时再用一个二字词。 */
async function retrieveGraph(
  graphService: GraphService,
  query: string,
  size: number,
  caseViewer: DocumentViewer,
) {
  const keyword = [...query.trim()].slice(0, 100).join('');
  const view = await graphService.searchNodes(caseViewer, {
    keyword,
    limit: size,
  });
  const passages = graphPassages(view, size);
  const shorter = graphKeyword(query);
  if (passages.length > 0 || !shorter || shorter === query.trim())
    return passages;
  const again = await graphService.searchNodes(caseViewer, {
    keyword: shorter,
    limit: size,
  });
  return graphPassages(again, size);
}

async function produceAnswer(
  item: EvalCase,
  loop: AgentLoopResult,
  trace: ReturnType<typeof startChatTrace>,
): Promise<{ answer: string; handed: HybridHitView[]; infra: boolean }> {
  if (loop.outcome === 'unavailable' || loop.outcome === 'aborted') {
    return { answer: INFRA_ANSWER, handed: [], infra: true };
  }
  if (
    loop.outcome === 'refuse' ||
    (loop.outcome === 'answer' && loop.items.length === 0)
  ) {
    return {
      answer: refuseCopy(loop.refuseReason).text,
      handed: [],
      infra: loop.refuseReason === 'web-unavailable',
    };
  }
  if (
    loop.outcome === 'preference' &&
    !item.memory?.trim() &&
    !item.longTerm?.trim()
  ) {
    return { answer: UNANSWERABLE, handed: [], infra: false };
  }
  const [instructions, prompt] = promptOf(
    loop.outcome,
    item.question,
    loop.items,
    item.memory ?? '',
    item.longTerm ?? '',
  );
  try {
    const answer = await trace.span(
      '生成回答',
      'llm',
      {
        intent: loop.outcome,
        query: loop.query,
        documentCount: loop.items.length,
      },
      async () => {
        const { text } = await tracedGenerateText({
          model: createChatModel(),
          system: instructions,
          prompt,
          temperature: 0,
        });
        return text.trim() || UNANSWERABLE;
      },
      (text) => ({ answer: text }),
    );
    return {
      answer,
      handed: loop.outcome === 'answer' ? loop.items : [],
      infra: false,
    };
  } catch {
    return { answer: '对话暂时不可用，请稍后再试。', handed: [], infra: true };
  }
}

async function gradeAnswer(
  item: EvalCase,
  produced: { answer: string; handed: HybridHitView[]; infra: boolean },
  labels: Array<{ chunkId: string; documentId: string }>,
  trace: ReturnType<typeof startChatTrace>,
): Promise<
  Pick<
    CaseReport,
    'faithfulness' | 'relevancy' | 'completeness' | 'utilization'
  >
> {
  if (produced.infra) {
    const reason = '检索或模型没有正常完成，这四项不记入平均分。';
    return {
      faithfulness: skipped(reason),
      relevancy: skipped(reason),
      completeness: skipped(reason),
      utilization: skipped(reason),
    };
  }
  const refused = produced.answer.trim() === UNANSWERABLE;
  const faithfulness = refused
    ? scored(1, '拒答句没有另写事实。')
    : await trace.span(
        '忠实度',
        'chain',
        { question: item.question },
        () => judgeFaithfulness(produced.answer, produced.handed),
        (value) => value,
      );
  const relevancy = refused
    ? scored(
        item.expectRefuse ? 1 : 0,
        item.expectRefuse ? '这题应该拒答。' : '问题需要回答，结果拒答了。',
      )
    : await trace.span(
        '答案相关性',
        'chain',
        { question: item.question },
        () => judgeRelevancy(item.question, produced.answer),
        (value) => value,
      );
  const completeness = await scoreCompleteness(
    item,
    produced.answer,
    refused,
    trace,
  );
  const utilization = await scoreUtilization(labels, produced, trace);
  return { faithfulness, relevancy, completeness, utilization };
}

async function scoreCompleteness(
  item: EvalCase,
  answer: string,
  refused: boolean,
  trace: ReturnType<typeof startChatTrace>,
): Promise<MetricScore> {
  if (item.expectRefuse || item.keyPoints.length === 0) {
    return skipped('这题不评完整性。拒答题和没有标准要点的题跳过。');
  }
  if (refused) return scored(0, '拒答没有覆盖任何要点。');
  return trace.span(
    '答案完整性',
    'chain',
    { question: item.question, points: item.keyPoints.length },
    () => judgeCompleteness(item.question, answer, item.keyPoints),
    (value) => value,
  );
}

async function scoreUtilization(
  labels: Array<{ chunkId: string; documentId: string }>,
  produced: { answer: string; handed: HybridHitView[] },
  trace: ReturnType<typeof startChatTrace>,
): Promise<MetricScore> {
  if (labels.length === 0) return skipped('这题没有必需切片，不评利用率。');
  const passages = produced.handed.flatMap((hit) => {
    const matched = labels.some((label) => label.chunkId === hit.chunkId);
    if (!matched) return [];
    return [{ id: hit.chunkId, text: hit.content }];
  });
  const unique = [
    ...new Map(passages.map((passage) => [passage.id, passage])).values(),
  ];
  if (unique.length === 0)
    return skipped('必需切片没有送进回答，记在 Recall 里，利用率跳过。');
  if (produced.answer.trim() === UNANSWERABLE)
    return scored(0, '回答没有使用送进来的切片。');
  return trace.span(
    '上下文利用率',
    'chain',
    { passages: unique.length },
    () => judgeUtilization(produced.answer, unique),
    (value) => value,
  );
}

function emptyReport(item: EvalCase): CaseReport {
  const pending = skipped('还没有打分。');
  return {
    durationMs: 0,
    status: 'completed',
    calls: { model: 0, tool: 0 },
    expectRefuse: item.expectRefuse,
    refused: false,
    id: item.id,
    question: item.question,
    note: item.note,
    expectedIntent: item.intent,
    actualIntent: null,
    intentMatched: null,
    usedWeb: false,
    retrieval: null,
    retrievalNote: '',
    handed: null,
    faithfulness: pending,
    relevancy: pending,
    completeness: pending,
    utilization: pending,
    answer: '',
    error: '',
  };
}
