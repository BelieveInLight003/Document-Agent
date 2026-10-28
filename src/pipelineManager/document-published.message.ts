/** 文档发布后投递给下游管线的消息。 */
export type DocumentPublishedMessage = {
  documentId: string;
  /** kh_document.content_id，即 MongoDB document_content 的 _id */
  contentId: string;
  title: string;
  publishedAt: string;
};
