import type { Document } from '../document/entities/document.entity.js';

/** 检索命中后从 Postgres 带出的文档。contentId 是 MongoDB 正文 _id。 */
export type SearchDocumentView = {
  id: string;
  title: string;
  contentId: string;
  summary: string | null;
  status: number;
  tags: string | null;
  authorId: string | null;
  categoryId: string | null;
  teamId: string | null;
  publishTime: Date | null;
};

/** 一条命中。highlights 最多 3 段，关键词用 em 包住。 */
export type SearchHitView = {
  score: number | null;
  highlights: string[];
  document: SearchDocumentView;
};

export type SearchResultView = {
  total: number;
  page: number;
  pageSize: number;
  list: SearchHitView[];
};

export function searchDocumentView(document: Document): SearchDocumentView {
  return {
    id: document.id.toString(),
    title: document.title,
    contentId: document.contentId,
    summary: document.summary,
    status: document.status,
    tags: document.tags,
    authorId: document.authorId?.toString() ?? null,
    categoryId: document.categoryId?.toString() ?? null,
    teamId: document.teamId?.toString() ?? null,
    publishTime: document.publishTime,
  };
}
