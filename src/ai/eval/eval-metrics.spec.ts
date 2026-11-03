import { describe, expect, it } from 'vitest';
import { scoreRetrieval } from './eval-metrics.js';

const hit = (chunkId: string, documentId = 'doc') => ({ chunkId, documentId });

describe('检索指标', () => {
  it('正确内容在第 2 位时，MRR 是 1/2', () => {
    const score = scoreRetrieval([hit('a'), hit('b')], [{ chunkId: 'b', documentId: 'doc' }]);
    expect(score.mrr).toBe(0.5);
    expect(score.hit).toBe(1);
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(1 / 5);
  });

  it('返回 5 条、其中 2 条有用时，Precision@5 是 0.4', () => {
    const score = scoreRetrieval(
      [hit('a'), hit('b'), hit('c'), hit('d'), hit('e')],
      [
        { chunkId: 'b', documentId: 'doc' },
        { chunkId: 'd', documentId: 'doc' },
      ],
    );
    expect(score.precision).toBeCloseTo(0.4);
    expect(score.recall).toBe(1);
    expect(score.matched).toBe(2);
  });

  it('两段必需切片只找回一段时，Recall 是 0，Hit 是 1', () => {
    const score = scoreRetrieval([hit('a')], [
      { chunkId: 'a', documentId: 'doc' },
      { chunkId: 'b', documentId: 'doc' },
    ]);
    expect(score.recall).toBe(0);
    expect(score.hit).toBe(1);
    expect(score.matched).toBe(1);
    expect(score.required).toBe(2);
  });

  it('只标了文档时，同一文档的任意切片算命中', () => {
    const score = scoreRetrieval([hit('other', 'doc-1')], [{ chunkId: '', documentId: 'doc-1' }]);
    expect(score.recall).toBe(1);
    expect(score.hit).toBe(1);
  });

  it('没有命中时四项都是 0', () => {
    const score = scoreRetrieval([hit('a')], [{ chunkId: 'z', documentId: 'doc' }]);
    expect(score.recall).toBe(0);
    expect(score.precision).toBe(0);
    expect(score.mrr).toBe(0);
    expect(score.hit).toBe(0);
  });
});
