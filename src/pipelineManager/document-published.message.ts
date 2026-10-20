/** 文档发布后投递给下游管线的消息。 */
export type DocumentPublishedMessage = {
  documentId: string;
  contentId: string;
  title: string;
  publishedAt: string;
};
