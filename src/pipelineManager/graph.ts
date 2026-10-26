import { Logger } from '@nestjs/common';
import neo4j, { type Driver } from 'neo4j-driver';
import { splitToChunks } from './chunk.js';
import {
  extractChunkGraph,
  inferGraphRules,
  type ExtractedRelation,
} from './graph-extract.js';

const logger = new Logger('DocumentGraph');

let driver: Driver | undefined;

type Neo4jConfig = {
  enabled: boolean;
  uri: string;
  user: string;
  password: string;
  database: string;
};

/** Neo4j 连接配置，调用时再读 .env。 */
function getNeo4jConfig(): Neo4jConfig {
  const enabled = process.env.NEO4J_ENABLED ?? 'true';
  return {
    enabled: enabled === 'true' || enabled === '1',
    uri: process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    user: process.env.NEO4J_USER ?? 'neo4j',
    password: process.env.NEO4J_PASSWORD ?? '12345678',
    database: process.env.NEO4J_DATABASE ?? 'neo4j',
  };
}

function getDriver(config: Neo4jConfig) {
  if (!driver) {
    driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.user, config.password),
    );
  }
  return driver;
}

export type GraphWriteResult = {
  chunks: number;
  entities: number;
  relations: number;
};

/**
 * 创建一篇文档的图谱。
 * 文档节点按 documentId 唯一；切片是第二层，经 HAS_CHUNK 挂到文档上；
 * 实体是第三层，按类型加名称复用已有节点。同一篇文档会先清掉旧图再写。
 */
export async function createDocumentGraph(input: {
  documentId: string;
  contentId: string;
  title: string;
  publishedAt: string;
  content: string;
}): Promise<GraphWriteResult | null> {
  const config = getNeo4jConfig();
  if (!config.enabled) {
    logger.warn('Neo4j 未启用，跳过创建图谱');
    return null;
  }

  const chunks = await splitToChunks(input.title, input.content);
  if (chunks.length === 0) {
    throw new Error('文档切分结果为空');
  }

  const rules = await inferGraphRules(input.title, input.content);
  logger.log(
    `实体规则 documentId=${input.documentId}\n${JSON.stringify(rules.entityRules, null, 2)}`,
  );
  logger.log(
    `关系规则 documentId=${input.documentId}\n${JSON.stringify(rules.relationRules, null, 2)}`,
  );

  const mentions: { chunkId: string; name: string; type: string }[] = [];
  const relations: (ExtractedRelation & { chunkId: string })[] = [];
  for (const chunk of chunks) {
    const extracted = await extractChunkGraph(rules, chunk.content);
    for (const entity of extracted.entities) {
      mentions.push({
        chunkId: chunk.id,
        name: entity.name,
        type: entity.type,
      });
    }
    for (const relation of extracted.relations) {
      relations.push({ ...relation, chunkId: chunk.id });
    }
  }

  await deleteDocumentGraph(input.documentId);

  const session = getDriver(config).session({ database: config.database });
  try {
    await session.run(
      'CREATE CONSTRAINT document_document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.documentId IS UNIQUE',
    );
    await session.run(
      'CREATE CONSTRAINT chunk_chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.chunkId IS UNIQUE',
    );
    await session.run(
      'CREATE CONSTRAINT entity_type_name IF NOT EXISTS FOR (e:Entity) REQUIRE (e.type, e.name) IS UNIQUE',
    );
    await session.executeWrite(async (tx) => {
      await tx.run(
        `
        MERGE (d:Document {documentId: $documentId})
        SET d.contentId = $contentId,
            d.title = $title,
            d.publishedAt = $publishedAt
        WITH d
        UNWIND $chunks AS chunk
        MERGE (c:Chunk {chunkId: chunk.id})
        SET c.documentId = $documentId,
            c.title = chunk.title,
            c.content = chunk.content,
            c.index = toInteger(chunk.index)
        MERGE (d)-[h:HAS_CHUNK]->(c)
        SET h.index = toInteger(chunk.index)
        `,
        {
          documentId: input.documentId,
          contentId: input.contentId,
          title: input.title,
          publishedAt: input.publishedAt,
          chunks: chunks.map((chunk, index) => ({
            id: chunk.id,
            title: chunk.title,
            content: chunk.content,
            index,
          })),
        },
      );
      if (mentions.length > 0) {
        await tx.run(
          `
          UNWIND $mentions AS mention
          MATCH (c:Chunk {chunkId: mention.chunkId})
          MERGE (e:Entity {type: mention.type, name: mention.name})
          MERGE (c)-[m:MENTIONS]->(e)
          SET m.documentId = $documentId
          `,
          { documentId: input.documentId, mentions },
        );
      }
      if (relations.length > 0) {
        await tx.run(
          `
          UNWIND $relations AS rel
          MERGE (s:Entity {type: rel.sourceType, name: rel.source})
          MERGE (t:Entity {type: rel.targetType, name: rel.target})
          MERGE (s)-[r:RELATED {documentId: $documentId, chunkId: rel.chunkId, type: rel.type}]->(t)
          `,
          { documentId: input.documentId, relations },
        );
      }
    });
  } finally {
    await session.close();
  }

  const entityKeys = new Set<string>();
  for (const mention of mentions) {
    entityKeys.add(`${mention.type}\0${mention.name}`);
  }
  for (const relation of relations) {
    entityKeys.add(`${relation.sourceType}\0${relation.source}`);
    entityKeys.add(`${relation.targetType}\0${relation.target}`);
  }
  return {
    chunks: chunks.length,
    entities: entityKeys.size,
    relations: relations.length,
  };
}

/**
 * 删除一篇文档的图谱。
 * 文档节点、经 HAS_CHUNK 挂上的 chunk，以及只属于这篇文档的关系都会去掉。
 * 仍被其他文档引用的实体保留。图里还没有这篇文档时直接返回。
 */
export async function deleteDocumentGraph(documentId: string) {
  const config = getNeo4jConfig();
  if (!config.enabled) {
    logger.warn('Neo4j 未启用，跳过删除图谱');
    return;
  }

  const session = getDriver(config).session({ database: config.database });
  try {
    await session.executeWrite(async (tx) => {
      await tx.run(
        `
        MATCH ()-[r:RELATED {documentId: $documentId}]-()
        DELETE r
        `,
        { documentId },
      );
      await tx.run(
        `
        MATCH (d:Document {documentId: $documentId})
        OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
        WITH d, collect(DISTINCT c) AS chunks
        FOREACH (c IN chunks | DETACH DELETE c)
        DETACH DELETE d
        `,
        { documentId },
      );
      await tx.run(
        `
        MATCH (c:Chunk {documentId: $documentId})
        DETACH DELETE c
        `,
        { documentId },
      );
      await tx.run(
        `
        MATCH (e:Entity)
        WHERE NOT (e)<-[:MENTIONS]-()
          AND NOT (e)-[:RELATED]-()
          AND NOT ()-[:RELATED]->(e)
        DETACH DELETE e
        `,
      );
    });
  } finally {
    await session.close();
  }
}
