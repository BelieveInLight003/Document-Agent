import { getChunkIndexTarget } from '../../pipelineManager/vector-index.js';
import type { GoldChunk, ResolvedGold } from './eval-case.js';

type ChunkSource = {
  chunkId?: string;
  documentId?: string;
  content?: string;
};

/**
 * 把数据集里的切片对到当前索引。
 * 先按 chunkId 找。找不到，再在同一篇文档里找包含 mustContain 的正文。
 * 两种都没有时记成 missing，这题的检索分数留空，避免用过期 id 把 Recall 打成 0。
 */
export async function resolveGold(labels: GoldChunk[]): Promise<ResolvedGold[]> {
  const target = getChunkIndexTarget();
  if (!target) {
    return labels.map((label) => ({ ...label, resolvedChunkId: '', how: 'missing' }));
  }
  const resolved: ResolvedGold[] = [];
  for (const label of labels) {
    const byId = await findChunk(target.client, target.index, { term: { chunkId: label.chunkId } });
    if (byId?.chunkId) {
      resolved.push({ ...label, resolvedChunkId: byId.chunkId, how: 'chunkId' });
      continue;
    }
    const rows = await findChunks(target.client, target.index, { term: { documentId: label.documentId } });
    const fallback = rows.find((row) => (row.content ?? '').includes(label.mustContain));
    if (fallback?.chunkId) {
      resolved.push({ ...label, resolvedChunkId: fallback.chunkId, how: 'mustContain' });
      continue;
    }
    resolved.push({ ...label, resolvedChunkId: '', how: 'missing' });
  }
  return resolved;
}

async function findChunk(
  client: NonNullable<ReturnType<typeof getChunkIndexTarget>>['client'],
  index: string,
  query: { term: Record<string, string> },
) {
  const rows = await findChunks(client, index, query, 1);
  return rows[0];
}

async function findChunks(
  client: NonNullable<ReturnType<typeof getChunkIndexTarget>>['client'],
  index: string,
  query: { term: Record<string, string> },
  size = 20,
) {
  try {
    const result = await client.search<ChunkSource>({ index, size, query });
    return result.hits.hits.flatMap((hit) => (hit._source ? [hit._source] : []));
  } catch {
    return [];
  }
}
