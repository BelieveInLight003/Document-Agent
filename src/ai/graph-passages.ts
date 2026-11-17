import type { GraphView } from '../graph/graph.view.js';
import type { HybridHitView } from './ai.view.js';

/** 文档到切片、切片到实体是结构边，不能当作回答依据。 */
const STRUCTURAL = new Set(['HAS_CHUNK', 'MENTIONS', 'HAS_DOCUMENT']);

/** 整句里抽一个图谱能用的二字词。图谱是包含匹配，长问句经常对不上实体名。 */
const SKIP_GRAM =
  /谁|什么|怎么|如何|是否|可以|哪些|这个|那个|流程|制度|规定|问题|一下|进行|相关|需要|为什么|怎样/;

export function graphKeyword(query: string): string {
  const chars = [...query.replace(/\s+/g, '').trim()];
  if (chars.length <= 4) return chars.join('');
  for (let index = 0; index < chars.length - 1; index += 1) {
    const gram = chars[index] + chars[index + 1];
    if (SKIP_GRAM.test(gram)) continue;
    if (/^[\u4e00-\u9fff]{2}$/.test(gram)) return gram;
  }
  return chars.slice(0, 2).join('');
}

/**
 * 把一次图谱检索收成可以评估和引用的资料。
 * 优先用语义关系：实体 —关系→ 实体。没有语义关系时，退回实体名称。
 * 能对应到文档时带上 documentId，来源列表才能打开原文。
 */
export function graphPassages(
  graph: GraphView,
  limit: number,
): HybridHitView[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const documents = new Map(
    graph.nodes
      .filter((node) => node.label === 'Document')
      .map((node) => [node.documentId, node]),
  );
  const chunks = new Map(
    graph.nodes
      .filter((node) => node.label === 'Chunk')
      .map((node) => [node.chunkId, node]),
  );
  const passages: HybridHitView[] = [];
  const seen = new Set<string>();
  const push = (passage: HybridHitView) => {
    const key = `${passage.documentId}:${passage.content}`;
    if (seen.has(key) || passages.length >= limit) return;
    seen.add(key);
    passages.push(passage);
  };

  for (const relation of graph.relations) {
    if (STRUCTURAL.has(relation.type) || STRUCTURAL.has(relation.name))
      continue;
    const source = nodes.get(relation.source);
    const target = nodes.get(relation.target);
    const documentNode = documents.get(relation.documentId);
    const document =
      documentNode?.document ?? source?.document ?? target?.document ?? null;
    const chunk = chunks.get(relation.chunkId);
    if (
      !document ||
      !chunk ||
      chunk.documentId !== document.id ||
      !chunk.content?.trim()
    )
      continue;
    const from = source?.name || source?.title || '未知';
    const to = target?.name || target?.title || '未知';
    const preview = chunk.content;
    const line = `${from} —${relation.name || relation.type}→ ${to}`;
    push({
      chunkId: chunk.chunkId ?? relation.id,
      documentId:
        relation.documentId ??
        source?.documentId ??
        target?.documentId ??
        document?.id ??
        '',
      contentId:
        document?.contentId ?? source?.contentId ?? target?.contentId ?? '',
      title: document?.title || source?.title || target?.title || '知识图谱',
      chapter: relation.name || relation.type,
      content: preview ? `${line}\n${preview}` : line,
      score: 1,
      channels: ['graph'],
    });
  }
  if (passages.length > 0) return passages;

  for (const node of graph.nodes) {
    if (node.label !== 'Chunk' || !node.content?.trim()) continue;
    const document = documents.get(node.documentId)?.document;
    if (!document) continue;
    const content = node.content;
    push({
      chunkId: node.id,
      documentId: document.id,
      contentId: document.contentId,
      title: document.title,
      chapter: node.entityType,
      content,
      score: 1,
      channels: ['graph'],
    });
  }
  return passages;
}
