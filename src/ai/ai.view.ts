/** 一条融合后的切片。channels 标出它来自关键词、向量，或两路都命中。 */
export type HybridHitView = {
  chunkId: string;
  documentId: string;
  contentId: string;
  title: string;
  chapter: string | null;
  content: string;
  score: number;
  channels: Array<'keyword' | 'vector'>;
};

export type HybridResultView = {
  question: string;
  items: HybridHitView[];
};

/** answer 只依据 items 里的原文。资料不足时是固定的拒答句。 */
export type ChatResultView = {
  question: string;
  answer: string;
  items: HybridHitView[];
};
