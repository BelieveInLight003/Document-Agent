import { Logger } from '@nestjs/common';
import type { Client } from '@elastic/elasticsearch';
import { createEmbeddings } from '../pipelineManager/embedding.js';
import { getChunkIndexTarget } from '../pipelineManager/vector-index.js';

const logger = new Logger('HybridRetriever');

/** 每一路取出的候选数。融合后再截断到调用方要的条数。 */
const CANDIDATES = 20;
/** 倒数排名融合的平滑常数。排名越靠前，加分越大。 */
const RRF_K = 60;
/**
 * 向量相似度下限。Elasticsearch 的 cosine 分数是 (1 + cosine) / 2。
 * 近邻检索总会返回最近的切片，库里只有几条时，不相关的问题也会把它们带出来。
 * 0.75 大约对应 cosine 0.5，低于这个分数视为不相关。
 */
const VECTOR_MIN_SCORE = 0.75;
const COARSE_ANALYZER = 'ik_smart';

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  contentId: string;
  title: string;
  chapter: string | null;
  content: string;
  score: number;
  channels: Array<'keyword' | 'vector'>;
};

type ChunkSource = {
  chunkId?: string;
  documentId?: string;
  contentId?: string;
  title?: string;
  chapter?: string;
  content?: string;
};

/** 关键词和向量各查一路，按 chunkId 做倒数排名融合。索引不存在时返回空数组。 */
export async function retrieveChunks(question: string, limit: number) {
  const target = getChunkIndexTarget();
  if (!target) {
    throw new Error('向量索引未启用');
  }

  const exists = await target.client.indices.exists({ index: target.index });
  if (!exists) {
    return [];
  }

  const [keyword, vector] = await Promise.all([
    searchKeyword(target.client, target.index, question),
    searchVector(target.client, target.index, question),
  ]);
  return fuse(keyword, vector).slice(0, limit);
}

async function searchKeyword(client: Client, index: string, question: string) {
  try {
    const result = await client.search<ChunkSource>({
      index,
      size: CANDIDATES,
      query: {
        multi_match: {
          query: question,
          fields: ['title^2', 'chapter', 'content'],
          type: 'best_fields',
          analyzer: COARSE_ANALYZER,
          fuzziness: 'AUTO',
          prefix_length: 1,
          operator: 'or',
        },
      },
    });
    return result.hits.hits.map((hit) => hit._source);
  } catch (error) {
    logger.error(
      '关键词检索失败',
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

async function searchVector(client: Client, index: string, question: string) {
  try {
    const vector = await createEmbeddings().embedQuery(question);
    const result = await client.search<ChunkSource>({
      index,
      size: CANDIDATES,
      knn: {
        field: 'embedding',
        query_vector: vector,
        k: CANDIDATES,
        num_candidates: CANDIDATES * 5,
      },
    });
    return result.hits.hits.flatMap((hit) => {
      if (!hit._source || (hit._score ?? 0) < VECTOR_MIN_SCORE) {
        return [];
      }
      return [hit._source];
    });
  } catch (error) {
    logger.error(
      '向量检索失败',
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

function fuse(
  keyword: Array<ChunkSource | undefined>,
  vector: Array<ChunkSource | undefined>,
) {
  const hits = new Map<string, RetrievedChunk>();
  addChannel(hits, keyword, 'keyword');
  addChannel(hits, vector, 'vector');
  return [...hits.values()].sort((left, right) => right.score - left.score);
}

function addChannel(
  hits: Map<string, RetrievedChunk>,
  sources: Array<ChunkSource | undefined>,
  channel: 'keyword' | 'vector',
) {
  sources.forEach((source, index) => {
    const chunkId = source?.chunkId;
    const content = source?.content?.trim();
    if (!chunkId || !content || !source.documentId) {
      return;
    }
    const score = 1 / (RRF_K + index + 1);
    const current = hits.get(chunkId);
    if (!current) {
      hits.set(chunkId, {
        chunkId,
        documentId: source.documentId,
        contentId: source.contentId ?? '',
        title: source.title?.trim() || '未命名文档',
        chapter: source.chapter?.trim() || null,
        content,
        score,
        channels: [channel],
      });
      return;
    }
    current.score += score;
    if (!current.channels.includes(channel)) {
      current.channels.push(channel);
    }
  });
}
