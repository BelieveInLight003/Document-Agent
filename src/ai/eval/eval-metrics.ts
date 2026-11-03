/**
 * 检索层四项。全部用标注切片来比，不调用模型。
 *
 * 默认只看前 5 条，和线上检索条数、图里的 @5 一致。
 * Recall：必需切片是不是全都在前 5 条里。全在记 1，少一条记 0。
 * Precision：前 5 条里有几条是必需切片，再除以 5。只找回 2 条有用的，也是 2/5。
 * MRR：第一条必需切片排在第几位，取得分 1/排名。第 2 位就是 1/2。一条都没有记 0。
 * Hit：前 5 条里只要有一条必需切片就记 1。
 */

export const EVAL_K = 5;

export type ScoredHit = {
  chunkId: string;
  documentId: string;
};

export type GoldLabel = {
  /** 有切片 id 时必须对上这一条。空字符串表示整篇文档都算命中。 */
  chunkId: string;
  documentId: string;
};

export type RetrievalScore = {
  recall: number;
  precision: number;
  mrr: number;
  hit: number;
  matched: number;
  required: number;
};

export function scoreRetrieval(hits: ScoredHit[], gold: GoldLabel[], k = EVAL_K): RetrievalScore {
  const top = hits.slice(0, k);
  const required = gold.length;
  const matched = gold.filter((label) => top.some((hit) => samePassage(hit, label))).length;
  const relevant = top.filter((hit) => gold.some((label) => samePassage(hit, label))).length;
  const rank = top.findIndex((hit) => gold.some((label) => samePassage(hit, label)));
  return {
    recall: required > 0 && matched === required ? 1 : 0,
    precision: relevant / k,
    mrr: rank < 0 ? 0 : 1 / (rank + 1),
    hit: matched > 0 ? 1 : 0,
    matched,
    required,
  };
}

/** 送进回答的资料里，对上了几条必需切片。 */
export function countMatched(hits: ScoredHit[], gold: GoldLabel[]) {
  return gold.filter((label) => hits.some((hit) => samePassage(hit, label))).length;
}

export function samePassage(hit: ScoredHit, label: GoldLabel) {
  if (label.chunkId) return hit.chunkId === label.chunkId;
  return label.documentId.length > 0 && hit.documentId === label.documentId;
}
