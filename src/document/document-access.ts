import { RoleCode } from '../user/role-code.js';
import { DocumentStatus } from './document-status.js';

/**
 * 检索时的阅读人。userId 用字符串，避免雪花 id 被转成 Number 后丢精度。
 * roles 是角色编码，例如 ROLE_ADMIN、ROLE_REVIEWER。
 */
export type DocumentViewer = {
  userId: string;
  roles: string[];
};

/**
 * 判断阅读权限需要的文档字段。
 * authorId 已转成字符串；没有作者时是 null。
 */
export type DocumentAccessTarget = {
  status: number;
  isPublic: boolean;
  authorId: string | null;
  deleted: boolean;
};

/** 从登录用户抽出检索要用的阅读人。 */
export function documentViewer(user: { id: string; roles: string[] }): DocumentViewer {
  return { userId: user.id, roles: user.roles };
}

/**
 * 把数据库里的文档收成权限判断用的字段。
 * authorId 保持字符串，和 DocumentViewer.userId 直接比较。
 */
export function toDocumentAccess(row: {
  status: number;
  isPublic: boolean;
  authorId: bigint | null;
  deleted: boolean;
}): DocumentAccessTarget {
  return {
    status: row.status,
    isPublic: row.isPublic,
    authorId: row.authorId?.toString() ?? null,
    deleted: row.deleted,
  };
}

/**
 * 文档能不能被检索到。
 * 先看是不是已发布：草稿、待审核、归档、已删除都不能查，管理员和作者也不例外。
 * 已发布之后，下面三个条件满足任意一个即可：
 * 1. 当前用户是管理员或审核员
 * 2. 文档作者就是当前用户
 * 3. 文档是公开的
 * 三个都不满足时，这篇文档不能进入检索结果。
 */
export function canReadDocument(viewer: DocumentViewer, document: DocumentAccessTarget) {
  if (!isPublishedDocument(document)) {
    return false;
  }
  return isPrivilegedReader(viewer) || isDocumentAuthor(viewer, document) || isPublicDocument(document);
}

/** 只有未删除、状态为已发布的文档可以查询。 */
export function isPublishedDocument(document: Pick<DocumentAccessTarget, 'status' | 'deleted'>) {
  return !document.deleted && document.status === DocumentStatus.PUBLISHED;
}

/** 管理员和审核员可以阅读全部已发布文档。 */
export function isPrivilegedReader(viewer: DocumentViewer) {
  return viewer.roles.includes(RoleCode.ADMIN) || viewer.roles.includes(RoleCode.REVIEWER);
}

/** 作者可以阅读自己名下的已发布文档，即使文档没有公开。 */
export function isDocumentAuthor(
  viewer: DocumentViewer,
  document: Pick<DocumentAccessTarget, 'authorId'>,
) {
  return document.authorId != null && document.authorId === viewer.userId;
}

/** 公开文档对所有登录用户可读，但仍必须已经发布。 */
export function isPublicDocument(document: Pick<DocumentAccessTarget, 'isPublic'>) {
  return document.isPublic;
}

/**
 * 按文档权限留下能读的切片。
 * 库里找不到文档时视为不可读，避免索引里的旧切片绕过权限。
 * 顺序保持检索时的相关度排序。
 */
export function filterReadableChunks<T extends { documentId: string }>(
  items: T[],
  viewer: DocumentViewer,
  documents: ReadonlyMap<string, DocumentAccessTarget>,
) {
  return items.filter((item) => {
    const document = documents.get(item.documentId);
    return document != null && canReadDocument(viewer, document);
  });
}

/**
 * 这篇文档 id 对当前用户是否可读。
 * 没有 id、库里没有这条文档、或权限不通过，都视为不可读。
 */
export function canReadDocumentId(
  documentId: string | null,
  viewer: DocumentViewer,
  documents: ReadonlyMap<string, DocumentAccessTarget>,
) {
  if (!documentId) {
    return false;
  }
  const document = documents.get(documentId);
  return document != null && canReadDocument(viewer, document);
}

/**
 * 去掉知识图谱里不能读的文档，以及只挂在这些文档上的切片、实体和关系。
 * 实体节点本身往往不带 documentId，要看它剩下的边还属不属于可读文档。
 * 一条边只要标明了 documentId，这篇文档不可读时边就去掉。
 */
export function filterReadableGraph<
  TNode extends { id: string; documentId: string | null },
  TRelation extends { source: string; target: string; documentId: string | null },
>(
  graph: { nodes: TNode[]; relations: TRelation[] },
  viewer: DocumentViewer,
  documents: ReadonlyMap<string, DocumentAccessTarget>,
) {
  const nodes = graph.nodes.filter(
    (node) => !node.documentId || canReadDocumentId(node.documentId, viewer, documents),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const relations = graph.relations.filter((relation) => {
    if (relation.documentId && !canReadDocumentId(relation.documentId, viewer, documents)) {
      return false;
    }
    return nodeIds.has(relation.source) && nodeIds.has(relation.target);
  });
  const linked = new Set(relations.flatMap((relation) => [relation.source, relation.target]));
  const visibleNodes = nodes.filter((node) => node.documentId != null || linked.has(node.id));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  return {
    nodes: visibleNodes,
    relations: relations.filter(
      (relation) => visibleIds.has(relation.source) && visibleIds.has(relation.target),
    ),
  };
}
