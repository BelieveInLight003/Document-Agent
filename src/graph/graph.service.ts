import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import neo4j, {
  type Node,
  type QueryResult,
  type Relationship,
} from 'neo4j-driver';
import { In, Repository } from 'typeorm';
import {
  filterReadableGraph,
  toDocumentAccess,
  type DocumentViewer,
} from '../document/document-access.js';
import { decodeUploadedText } from '../document/decode-uploaded-text.js';
import { Document } from '../document/entities/document.entity.js';
import { getNeo4jTarget } from '../pipelineManager/graph.js';
import { GraphNodeQueryDto } from './dto/graph-node-query.dto.js';
import { GraphRelationQueryDto } from './dto/graph-relation-query.dto.js';
import type {
  GraphDocumentBrief,
  GraphNodeView,
  GraphRelationView,
  GraphView,
} from './graph.view.js';

const DEFAULT_LIMIT = 20;
/** 每个命中向外展开的行数上限，避免一张图把整库拉回来。 */
const EXPANSION_LIMIT = 400;
const PREVIEW_LENGTH = 120;
const NODE_LABELS = ['Document', 'Chunk', 'Entity'] as const;

const NODE_CYPHER = `
MATCH (seed)
WHERE (
  (seed:Document AND toLower(coalesce(seed.title, '')) CONTAINS toLower($keyword))
  OR (seed:Chunk AND (
    toLower(coalesce(seed.title, '')) CONTAINS toLower($keyword)
    OR toLower(coalesce(seed.content, '')) CONTAINS toLower($keyword)
  ))
  OR (seed:Entity AND (
    toLower(coalesce(seed.name, '')) CONTAINS toLower($keyword)
    OR toLower(coalesce(seed.type, '')) CONTAINS toLower($keyword)
  ))
)
AND ($label = '' OR $label IN labels(seed))
WITH seed
LIMIT $limit
CALL {
  WITH seed
  CALL {
    WITH seed
    WITH seed
    WHERE seed:Document
    OPTIONAL MATCH (seed)-[hasChunk:HAS_CHUNK]->(chunk:Chunk)
    OPTIONAL MATCH (chunk)-[mentions:MENTIONS]->(entity:Entity)
    OPTIONAL MATCH (entity)-[related:RELATED]-(other:Entity)
    WHERE related.documentId = seed.documentId
    RETURN seed AS n1, hasChunk AS r1, chunk AS n2, mentions AS r2, entity AS n3, related AS r3, other AS n4
    UNION
    WITH seed
    WITH seed
    WHERE seed:Chunk
    OPTIONAL MATCH (document:Document)-[hasChunk:HAS_CHUNK]->(seed)
    OPTIONAL MATCH (seed)-[mentions:MENTIONS]->(entity:Entity)
    OPTIONAL MATCH (entity)-[related:RELATED]-(other:Entity)
    WHERE related.documentId = document.documentId OR related.chunkId = seed.chunkId
    RETURN document AS n1, hasChunk AS r1, seed AS n2, mentions AS r2, entity AS n3, related AS r3, other AS n4
    UNION
    WITH seed
    WITH seed
    WHERE seed:Entity
    OPTIONAL MATCH (chunk:Chunk)-[mentions:MENTIONS]->(seed)
    OPTIONAL MATCH (document:Document)-[hasChunk:HAS_CHUNK]->(chunk)
    OPTIONAL MATCH (seed)-[related:RELATED]-(other:Entity)
    WHERE related.documentId = document.documentId OR document IS NULL
    RETURN document AS n1, hasChunk AS r1, chunk AS n2, mentions AS r2, seed AS n3, related AS r3, other AS n4
  }
  RETURN n1, r1, n2, r2, n3, r3, n4
  LIMIT $expansion
}
RETURN n1, r1, n2, r2, n3, r3, n4
`;

const RELATION_CYPHER = `
MATCH (source)-[relation]->(target)
WHERE ($relation = '' OR type(relation) = $relation)
AND (
  toLower(type(relation)) CONTAINS toLower($keyword)
  OR toLower(coalesce(relation.type, '')) CONTAINS toLower($keyword)
  OR toLower(coalesce(source.name, source.title, '')) CONTAINS toLower($keyword)
  OR toLower(coalesce(target.name, target.title, '')) CONTAINS toLower($keyword)
)
WITH source, relation, target
LIMIT $limit
OPTIONAL MATCH (document:Document)-[hasChunk:HAS_CHUNK]->(chunk:Chunk)
WHERE (
  relation.chunkId IS NOT NULL
  AND chunk.chunkId = relation.chunkId
  AND document.documentId = relation.documentId
) OR (
  source:Chunk AND chunk = source
) OR (
  target:Chunk AND chunk = target
)
OPTIONAL MATCH (chunk)-[mentions:MENTIONS]->(entity:Entity)
WHERE entity = source OR entity = target
RETURN source, relation, target, document, hasChunk, chunk, mentions, entity
`;

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
  ) {}

  /** 命中节点后展开到所属文档、切片、实体和它们之间的关系，再按文档权限裁剪。 */
  async searchNodes(viewer: DocumentViewer, query: GraphNodeQueryDto): Promise<GraphView> {
    const keyword = requiredKeyword(query.keyword);
    const result = await this.run(NODE_CYPHER, {
      keyword,
      label: query.label ?? '',
      limit: neo4j.int(query.limit ?? DEFAULT_LIMIT),
      expansion: neo4j.int(EXPANSION_LIMIT),
    });
    const graph = readGraph(result, ['n1', 'n2', 'n3', 'n4'], ['r1', 'r2', 'r3']);
    return this.applyDocumentAccess(viewer, graph);
  }

  /** 命中关系后补上两端节点，以及这条关系所属的文档和切片，再按文档权限裁剪。 */
  async searchRelations(viewer: DocumentViewer, query: GraphRelationQueryDto): Promise<GraphView> {
    const keyword = requiredKeyword(query.keyword);
    const result = await this.run(RELATION_CYPHER, {
      keyword,
      relation: query.relation ?? '',
      limit: neo4j.int(query.limit ?? DEFAULT_LIMIT),
    });
    const graph = readGraph(
      result,
      ['source', 'target', 'document', 'chunk', 'entity'],
      ['relation', 'hasChunk', 'mentions'],
    );
    return this.applyDocumentAccess(viewer, graph);
  }

  private async run(cypher: string, params: Record<string, unknown>) {
    const target = getNeo4jTarget();
    if (!target) {
      throw new ServiceUnavailableException('图谱检索未启用');
    }

    const session = target.driver.session({ database: target.database });
    try {
      return await session.run(cypher, params);
    } catch (error) {
      this.logger.error(
        '图谱检索失败',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('图谱检索不可用');
    } finally {
      await session.close();
    }
  }

  /**
   * 先按文档阅读权限去掉不能看的节点和边，再用 Postgres 标题覆盖剩下的文档节点。
   * 库里没有对应文档时，这张图上的相关节点也不会留下。
   */
  private async applyDocumentAccess(viewer: DocumentViewer, graph: GraphView): Promise<GraphView> {
    const ids = graphDocumentIds(graph);
    const rows =
      ids.length === 0
        ? []
        : await this.documentRepository.find({
            where: { id: In(ids.map((id) => BigInt(id))), deleted: false },
          });
    const documents = new Map(rows.map((row) => [row.id.toString(), toDocumentAccess(row)]));
    const visible = filterReadableGraph(graph, viewer, documents);
    const byId = new Map(rows.map((row) => [row.id.toString(), row]));
    return {
      relations: visible.relations,
      nodes: visible.nodes.map((node) => overlayDocumentNode(node, byId)),
    };
  }
}

/** 节点和边上出现过的文档 id。不是数字的 id 对不上资料库，后面会当成不可读。 */
function graphDocumentIds(graph: GraphView) {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (node.documentId && /^\d+$/.test(node.documentId)) {
      ids.add(node.documentId);
    }
  }
  for (const relation of graph.relations) {
    if (relation.documentId && /^\d+$/.test(relation.documentId)) {
      ids.add(relation.documentId);
    }
  }
  return [...ids];
}

/** 文档节点用 Postgres 里的正文 id 和标题覆盖，保证和资料库一致。 */
function overlayDocumentNode(node: GraphNodeView, documents: Map<string, Document>) {
  if (node.label !== 'Document' || !node.documentId) {
    return node;
  }
  const row = documents.get(node.documentId);
  if (!row) {
    return node;
  }
  const title = decodeUploadedText(row.title);
  const document: GraphDocumentBrief = {
    id: row.id.toString(),
    title,
    contentId: row.contentId,
    summary: row.summary ? decodeUploadedText(row.summary) : null,
    status: row.status,
  };
  return {
    ...node,
    name: title,
    title,
    contentId: row.contentId,
    document,
  };
}

function requiredKeyword(keyword: string) {
  const trimmed = keyword.trim();
  if (!trimmed) {
    throw new BadRequestException('关键词不能为空');
  }
  return trimmed;
}

function readGraph(
  result: QueryResult,
  nodeKeys: string[],
  relationKeys: string[],
): GraphView {
  const builder = new GraphBuilder();
  for (const record of result.records) {
    for (const key of nodeKeys) {
      builder.addNode(record.get(key));
    }
    for (const key of relationKeys) {
      builder.addRelation(record.get(key));
    }
  }
  return builder.finish();
}

class GraphBuilder {
  private readonly nodes = new Map<string, GraphNodeView>();
  private readonly relations = new Map<string, GraphRelationView>();
  private readonly elementToId = new Map<string, string>();
  private readonly pending: Relationship[] = [];

  addNode(value: unknown) {
    const node = asNode(value);
    if (!node) {
      return;
    }
    const view = toNodeView(node);
    this.elementToId.set(node.elementId, view.id);
    this.nodes.set(view.id, view);
  }

  addRelation(value: unknown) {
    const relation = asRelationship(value);
    if (!relation) {
      return;
    }
    const source = this.elementToId.get(relation.startNodeElementId);
    const target = this.elementToId.get(relation.endNodeElementId);
    if (!source || !target) {
      this.pending.push(relation);
      return;
    }
    this.relations.set(relation.elementId, toRelationView(relation, source, target));
  }

  finish(): GraphView {
    for (const relation of this.pending) {
      const source = this.elementToId.get(relation.startNodeElementId);
      const target = this.elementToId.get(relation.endNodeElementId);
      if (!source || !target) {
        continue;
      }
      this.relations.set(
        relation.elementId,
        toRelationView(relation, source, target),
      );
    }
    const relations = [...this.relations.values()].filter(
      (relation) =>
        this.nodes.has(relation.source) && this.nodes.has(relation.target),
    );
    return { nodes: [...this.nodes.values()], relations };
  }
}

function asNode(value: unknown): Node | null {
  if (
    value &&
    typeof value === 'object' &&
    'labels' in value &&
    'elementId' in value &&
    'properties' in value
  ) {
    return value as Node;
  }
  return null;
}

function asRelationship(value: unknown): Relationship | null {
  if (
    value &&
    typeof value === 'object' &&
    'elementId' in value &&
    'startNodeElementId' in value &&
    'type' in value &&
    !('labels' in value)
  ) {
    return value as Relationship;
  }
  return null;
}

function toNodeView(node: Node): GraphNodeView {
  const properties = node.properties as Record<string, unknown>;
  const label =
    NODE_LABELS.find((item) => node.labels.includes(item)) ??
    node.labels[0] ??
    'Node';
  const title = readable(text(properties.title));
  const entityType = label === 'Entity' ? readable(text(properties.type)) : null;
  const name =
    readable(text(properties.name)) ??
    title ??
    text(properties.chunkId) ??
    '未命名';
  const content = text(properties.content);
  return {
    id: nodeKey(label, properties),
    label,
    name,
    entityType,
    documentId: text(properties.documentId),
    contentId: text(properties.contentId),
    chunkId: text(properties.chunkId),
    title,
    index: integer(properties.index),
    contentPreview:
      label === 'Chunk' && content
        ? readable(content.slice(0, PREVIEW_LENGTH))
        : null,
    document: null,
  };
}

function toRelationView(
  relation: Relationship,
  source: string,
  target: string,
): GraphRelationView {
  const properties = relation.properties as Record<string, unknown>;
  const semantic = text(properties.type);
  return {
    id: relation.elementId,
    type: relation.type,
    name: decodeUploadedText(semantic ?? relation.type),
    source,
    target,
    documentId: text(properties.documentId),
    chunkId: text(properties.chunkId),
    index: integer(properties.index),
  };
}

function nodeKey(label: string, properties: Record<string, unknown>) {
  if (label === 'Document') {
    return `document:${text(properties.documentId) ?? ''}`;
  }
  if (label === 'Chunk') {
    return `chunk:${text(properties.chunkId) ?? ''}`;
  }
  return `entity:${text(properties.type) ?? ''}:${text(properties.name) ?? ''}`;
}

function text(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readable(value: string | null) {
  return value ? decodeUploadedText(value) : null;
}

function integer(value: unknown) {
  if (neo4j.isInt(value)) {
    return value.toNumber();
  }
  return typeof value === 'number' ? value : null;
}
