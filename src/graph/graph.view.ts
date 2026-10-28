/** 文档节点附带的 Postgres 资料。contentId 是 MongoDB 正文 _id。 */
export type GraphDocumentBrief = {
  id: string;
  title: string;
  contentId: string;
  summary: string | null;
  status: number;
};

/**
 * 前端绘图用的节点。id 在这一次结果里唯一，relations.source / target 指向它。
 * label 为 Document、Chunk 或 Entity。
 */
export type GraphNodeView = {
  id: string;
  label: string;
  name: string;
  entityType: string | null;
  documentId: string | null;
  contentId: string | null;
  chunkId: string | null;
  title: string | null;
  index: number | null;
  contentPreview: string | null;
  document: GraphDocumentBrief | null;
};

/** 前端绘图用的边。source、target 是节点 id。name 是关系上的语义名，没有时与 type 相同。 */
export type GraphRelationView = {
  id: string;
  type: string;
  name: string;
  source: string;
  target: string;
  documentId: string | null;
  chunkId: string | null;
  index: number | null;
};

/** 一次检索的子图。节点和边一起返回，前端可以直接成图。 */
export type GraphView = {
  nodes: GraphNodeView[];
  relations: GraphRelationView[];
};
