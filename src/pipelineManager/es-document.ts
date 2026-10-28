import { Logger } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';

const logger = new Logger('EsDocument');

let client: Client | undefined;

type ElasticsearchConfig = {
  enabled: boolean;
  node: string;
  index: string;
};

/** 整篇文档的关键词索引，调用时再读 .env。 */
function getElasticsearchConfig(): ElasticsearchConfig {
  const enabled = process.env.ELASTICSEARCH_ENABLED ?? 'true';
  return {
    enabled: enabled === 'true' || enabled === '1',
    node: process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200',
    index: process.env.ELASTICSEARCH_DOCUMENT_INDEX ?? 'es_document',
  };
}

function getClient(node: string) {
  if (!client) {
    client = new Client({ node });
  }
  return client;
}

/** 全文检索和写入共用同一个客户端。未启用时返回 null。 */
export function getEsDocumentTarget(): { client: Client; index: string } | null {
  const config = getElasticsearchConfig();
  if (!config.enabled) {
    return null;
  }
  return { client: getClient(config.node), index: config.index };
}

async function ensureIndex(es: Client, index: string) {
  const exists = await es.indices.exists({ index });
  if (exists) {
    return;
  }

  await es.indices.create({
    index,
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
    mappings: {
      properties: {
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
        content: {
          type: 'text',
          analyzer: 'ik_max_word',
          search_analyzer: 'ik_smart',
        },
        publishedAt: { type: 'date' },
      },
    },
  });
}

/** 整篇正文写入 es_document，同一文档按 documentId 覆盖。 */
export async function indexEsDocument(input: {
  documentId: string;
  contentId: string;
  title: string;
  content: string;
  publishedAt: string;
}) {
  const config = getElasticsearchConfig();
  if (!config.enabled) {
    logger.warn('Elasticsearch 未启用，跳过全文索引');
    return;
  }

  const es = getClient(config.node);
  await ensureIndex(es, config.index);
  await es.index({
    index: config.index,
    id: input.documentId,
    refresh: true,
    document: {
      documentId: input.documentId,
      contentId: input.contentId,
      title: input.title,
      content: input.content,
      publishedAt: input.publishedAt,
    },
  });
}

/** 从 es_document 删除一篇文档。索引或文档不存在时直接返回。 */
export async function deleteEsDocument(documentId: string) {
  const config = getElasticsearchConfig();
  if (!config.enabled) {
    logger.warn('Elasticsearch 未启用，跳过删除全文索引');
    return;
  }

  const es = getClient(config.node);
  const indexExists = await es.indices.exists({ index: config.index });
  if (!indexExists) {
    return;
  }

  const docExists = await es.exists({ index: config.index, id: documentId });
  if (!docExists) {
    return;
  }
  await es.delete({ index: config.index, id: documentId, refresh: true });
}
