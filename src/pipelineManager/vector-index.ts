import { Logger } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import type { EmbeddedChunk } from './embedding.js';

const logger = new Logger('VectorIndex');

let client: Client | undefined;

type ElasticsearchConfig = {
  enabled: boolean;
  node: string;
  index: string;
  dimensions: number;
};

/** 调用时读取 .env，避免模块加载时环境变量还没注入。 */
function getElasticsearchConfig(): ElasticsearchConfig {
  const enabled = process.env.ELASTICSEARCH_ENABLED ?? 'true';
  const dimensions = Number(process.env.EMBEDDING_DIMENSION ?? 1024);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('EMBEDDING_DIMENSION 无效');
  }

  return {
    enabled: enabled === 'true' || enabled === '1',
    node: process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200',
    index: process.env.ELASTICSEARCH_INDEX ?? 'knowledge_hub_chunks',
    dimensions,
  };
}

function getClient(node: string) {
  if (!client) {
    client = new Client({ node });
  }
  return client;
}

/** 索引不存在时创建。字段覆盖文档、标题、章节、chunk 和向量。 */
async function ensureIndex(es: Client, config: ElasticsearchConfig) {
  const exists = await es.indices.exists({ index: config.index });
  if (exists) {
    return;
  }

  await es.indices.create({
    index: config.index,
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
    mappings: {
      properties: {
        chunkId: { type: 'keyword' },
        documentId: { type: 'keyword' },
        contentId: { type: 'keyword' },
        title: {
          type: 'text',
          analyzer: 'ik_max_word',
          search_analyzer: 'ik_smart',
          fields: {
            keyword: { type: 'keyword', ignore_above: 256 },
          },
        },
        chapter: {
          type: 'text',
          analyzer: 'ik_max_word',
          search_analyzer: 'ik_smart',
          fields: {
            keyword: { type: 'keyword', ignore_above: 256 },
          },
        },
        content: {
          type: 'text',
          analyzer: 'ik_max_word',
          search_analyzer: 'ik_smart',
        },
        embedding: {
          type: 'dense_vector',
          dims: config.dimensions,
          index: true,
          similarity: 'cosine',
        },
      },
    },
  });
}

/** 将向量化后的 chunks 写入 Elasticsearch。同一文档先删旧数据再写入。 */
export async function indexEmbeddedChunks(input: {
  documentId: string;
  contentId: string;
  chunks: EmbeddedChunk[];
}) {
  const config = getElasticsearchConfig();
  if (!config.enabled) {
    logger.warn('Elasticsearch 未启用，跳过写入');
    return;
  }

  const es = getClient(config.node);
  await ensureIndex(es, config);
  await es.deleteByQuery({
    index: config.index,
    query: { term: { documentId: input.documentId } },
    refresh: true,
    conflicts: 'proceed',
  });
  if (input.chunks.length === 0) {
    return;
  }

  const operations = input.chunks.flatMap((chunk) => [
    { index: { _index: config.index, _id: chunk.id } },
    {
      chunkId: chunk.id,
      documentId: input.documentId,
      contentId: input.contentId,
      title: chunk.title,
      chapter: chapterOf(chunk.content),
      content: chunk.content,
      embedding: chunk.embedding,
    },
  ]);
  const result = await es.bulk({ refresh: true, operations });
  if (result.errors) {
    const failed = result.items.find((item) => item.index?.error);
    throw new Error(failed?.index?.error?.reason ?? 'Elasticsearch 写入失败');
  }
}

/** 删除一篇文档在索引里的全部分段。索引不存在时直接返回。 */
export async function deleteDocumentChunks(documentId: string) {
  const config = getElasticsearchConfig();
  if (!config.enabled) {
    logger.warn('Elasticsearch 未启用，跳过删除文档索引');
    return;
  }

  const es = getClient(config.node);
  const exists = await es.indices.exists({ index: config.index });
  if (!exists) {
    return;
  }

  await es.deleteByQuery({
    index: config.index,
    query: { term: { documentId } },
    refresh: true,
    conflicts: 'proceed',
  });
}

/** 删除当前配置的向量索引。索引不存在时直接返回。 */
export async function deleteVectorIndex() {
  const config = getElasticsearchConfig();
  if (!config.enabled) {
    logger.warn('Elasticsearch 未启用，跳过删除索引');
    return;
  }

  const es = getClient(config.node);
  const exists = await es.indices.exists({ index: config.index });
  if (!exists) {
    return;
  }

  await es.indices.delete({ index: config.index });
  logger.log(`已删除向量索引 index=${config.index}`);
}

function chapterOf(content: string) {
  return /^#{1,6}\s+(.+)$/m.exec(content)?.[1]?.trim() ?? '';
}
