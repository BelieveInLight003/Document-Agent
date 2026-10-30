import type { HybridHitView } from './ai.view.js';

/** 思考步骤。同 id 再推一次表示这一步有更新。 */
export type ChatStep = {
  id: string;
  kind: 'fold' | 'action' | 'sources' | 'plan' | 'done';
  title: string;
  detail?: string;
  status: 'running' | 'done';
  sources?: ChatSource[];
};

export type ChatSource = {
  documentId: string;
  title: string;
  chapter: string | null;
  /** 回答里的资料编号。有值时和正文中的 [n] 对应。 */
  index?: number;
  /** 网页来源。有值时打开这个链接，而不是站内文档。 */
  url?: string;
};

/** 新的助手消息把步骤和检索结果放在一起。旧消息的 payload 仍可能是切片数组。 */
export type ChatMessagePayload = {
  items: HybridHitView[];
  steps: ChatStep[];
};
