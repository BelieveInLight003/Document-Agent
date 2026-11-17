import type { AgentIntent } from '../agent-route.js';
import type { DocumentViewer } from '../../document/document-access.js';

/**
 * 一道评测题长什么样。
 *
 * 检索四项只认 gold 里的切片，不让模型决定「哪条算对」。
 * 生成四项才把回答交给模型裁判。
 * note 只写给人看，不参与打分。
 */
export type EvalCase = {
  id: string;
  question: string;
  /** 期望意图。走错会单独统计，不改八项分数。 */
  intent: AgentIntent;
  /**
   * 标准行为是拒答。
   * 评测不加载个人记忆，所以偏好题也标成拒答。
   */
  expectRefuse: boolean;
  /** 必需切片。空数组表示这题不评检索。 */
  gold: GoldChunk[];
  /** 标准答案要点。空数组表示不评完整性。 */
  keyPoints: string[];
  note: string;
  memory?: string;
  longTerm?: string;
  viewer?: DocumentViewer;
};

/**
 * 一条标准切片。
 * chunkId 对得上当前索引时直接用。
 * 文档重新切分后 id 会变，这时用同一 documentId 里包含 mustContain 的切片顶上。
 */
export type GoldChunk = {
  chunkId: string;
  documentId: string;
  /** 正文里能唯一对上的短词，尽量用数字、人名、英文，避免重新切分后对不上。 */
  mustContain: string;
};

/** 已经对上索引的标准切片。resolvedChunkId 为空表示这题的标注失效。 */
export type ResolvedGold = GoldChunk & {
  resolvedChunkId: string;
  how: 'chunkId' | 'mustContain' | 'missing';
};

/** 一项生成指标。skipped 是规则上不评，unevaluated 是裁判没有给出结果。 */
export type MetricScore = {
  value: number | null;
  state: 'scored' | 'skipped' | 'unevaluated';
  reason: string;
};

export type CaseReport = {
  durationMs: number;
  status: 'completed' | 'failed';
  calls: { model: number; tool: number };
  expectRefuse: boolean;
  refused: boolean;
  id: string;
  question: string;
  note: string;
  expectedIntent: AgentIntent;
  actualIntent: AgentIntent | null;
  intentMatched: boolean | null;
  usedWeb: boolean;
  /** 第一轮文档检索的四项。不评检索时是 null。 */
  retrieval: {
    recall: number;
    allEvidenceHit: number;
    precision: number;
    mrr: number;
    hit: number;
    matched: number;
    required: number;
  } | null;
  retrievalNote: string;
  /** 切题评估之后，真正送进回答的必需切片还剩几条。 */
  handed: { matched: number; required: number } | null;
  faithfulness: MetricScore;
  relevancy: MetricScore;
  completeness: MetricScore;
  utilization: MetricScore;
  answer: string;
  error: string;
};
