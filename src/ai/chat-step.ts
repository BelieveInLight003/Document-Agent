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
};

/** 新的助手消息把步骤和检索结果放在一起。旧消息的 payload 仍可能是切片数组。 */
export type ChatMessagePayload = {
  items: HybridHitView[];
  steps: ChatStep[];
};
