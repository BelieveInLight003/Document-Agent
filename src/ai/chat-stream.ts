import { createOpenAI } from '@ai-sdk/openai';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  createUIMessageStream,
  streamText,
  type UIMessage,
} from 'ai';
import type { HybridHitView } from './ai.view.js';
import type { ChatSource, ChatStep } from './chat-step.js';
import { answerPrompt, UNANSWERABLE } from './prompt.js';

type AnswerMessage = UIMessage<unknown, { step: ChatStep }>;

const ANSWER_PART = 'answer';

export function createAnswerStream(input: {
  question: string;
  limit: number;
  abortSignal: AbortSignal;
  retrieve: (question: string, limit: number) => Promise<HybridHitView[]>;
  onEnd: (result: {
    answer: string;
    items: HybridHitView[];
    steps: ChatStep[];
    aborted: boolean;
  }) => Promise<void>;
}) {
  const steps: ChatStep[] = [];
  let items: HybridHitView[] = [];
  let answer = '';
  let persisted = false;

  return createUIMessageStream<AnswerMessage>({
    execute: async ({ writer }) => {
      const publish = (step: ChatStep) => {
        const index = steps.findIndex((item) => item.id === step.id);
        if (index >= 0) steps[index] = step;
        else steps.push(step);
        writer.write({ type: 'data-step', id: step.id, data: step });
      };
      const writeText = (text: string) => {
        answer = text;
        writer.write({ type: 'text-start', id: ANSWER_PART });
        writer.write({ type: 'text-delta', id: ANSWER_PART, delta: text });
        writer.write({ type: 'text-end', id: ANSWER_PART });
      };
      const finish = (status: 'completed' | 'aborted') => {
        writer.setOutcome(status === 'aborted' ? { status: 'aborted' } : { status: 'completed' });
        writer.write({ type: 'finish-step' });
        writer.write({
          type: 'finish',
          finishReason: status === 'aborted' ? 'interrupted' : 'stop',
        });
      };

      writer.write({ type: 'start' });
      writer.write({ type: 'start-step' });
      const short = clip(input.question, 24);
      publish({
        id: 'organize',
        kind: 'fold',
        title: `整理「${short}」`,
        detail: '我先确认要查的对象和范围，再去知识库里找依据。',
        status: 'done',
      });
      publish({
        id: 'search',
        kind: 'action',
        title: `我将在知识库中检索「${input.question}」。`,
        status: 'running',
      });

      try {
        items = await input.retrieve(input.question, input.limit);
      } catch {
        publish({
          id: 'search',
          kind: 'action',
          title: `我将在知识库中检索「${input.question}」。`,
          status: 'done',
        });
        publish({
          id: 'sources',
          kind: 'sources',
          title: '检索失败',
          detail: '知识库暂时不可用。',
          status: 'done',
          sources: [],
        });
        publish({
          id: 'done',
          kind: 'done',
          title: '已完成',
          status: 'done',
        });
        writeText('混合检索暂时不可用，请稍后再试。');
        finish('completed');
        return;
      }

      if (input.abortSignal.aborted) {
        answer = '回答已中断。';
        finish('aborted');
        return;
      }

      const sources = sourcesOf(items);
      publish({
        id: 'search',
        kind: 'action',
        title: `我将在知识库中检索「${input.question}」。`,
        status: 'done',
      });
      publish({
        id: 'sources',
        kind: 'sources',
        title:
          items.length === 0
            ? '没有检索到相关资料'
            : `参考 ${items.length} 条资料，来自 ${sources.length} 篇文档`,
        status: 'done',
        sources,
      });
      publish({
        id: 'plan',
        kind: 'plan',
        title: '整理回答',
        detail:
          items.length === 0
            ? '知识库里没有能支撑回答的内容，我会直接说明。'
            : `我将根据这 ${sources.length} 篇文档整理回答，并标出依据。`,
        status: 'done',
      });
      publish({ id: 'done', kind: 'done', title: '已完成', status: 'done' });

      if (items.length === 0) {
        writeText(UNANSWERABLE);
        finish('completed');
        return;
      }

      let started = false;
      try {
        const { instructions, prompt } = answerPrompt(input.question, items);
        const result = streamText({
          model: chatModel(),
          system: instructions,
          prompt,
          temperature: 0,
          abortSignal: input.abortSignal,
        });
        writer.write({ type: 'text-start', id: ANSWER_PART });
        started = true;
        for await (const delta of result.textStream) {
          answer += delta;
          writer.write({ type: 'text-delta', id: ANSWER_PART, delta });
        }
        if (!answer.trim()) {
          answer = UNANSWERABLE;
          writer.write({ type: 'text-delta', id: ANSWER_PART, delta: answer });
        }
        writer.write({ type: 'text-end', id: ANSWER_PART });
      } catch (error) {
        if (input.abortSignal.aborted || isAbort(error)) {
          if (started) {
            writer.write({ type: 'text-end', id: ANSWER_PART });
          }
          if (!answer.trim()) answer = '回答已中断。';
          finish('aborted');
          return;
        }
        if (!started) {
          writeText('对话暂时不可用，请稍后再试。');
        } else {
          if (!answer.trim()) {
            answer = '对话暂时不可用，请稍后再试。';
            writer.write({ type: 'text-delta', id: ANSWER_PART, delta: answer });
          }
          writer.write({ type: 'text-end', id: ANSWER_PART });
        }
      }

      finish(input.abortSignal.aborted ? 'aborted' : 'completed');
    },
    onEnd: async ({ isAborted }) => {
      if (persisted) return;
      persisted = true;
      const content = answer.trim() || (isAborted ? '回答已中断。' : '');
      if (!content) return;
      await input.onEnd({
        answer: content,
        items,
        steps: [...steps],
        aborted: isAborted || input.abortSignal.aborted,
      });
    },
  });
}

function chatModel() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ServiceUnavailableException('对话模型未配置');
  }
  const baseURL =
    process.env.OPENAI_BASE_URL ??
    process.env.EMBEDDING_BASE_URL ??
    'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const name = process.env.CHAT_MODEL ?? 'qwen-plus';
  return createOpenAI({ apiKey, baseURL }).chat(name);
}

function sourcesOf(items: HybridHitView[]): ChatSource[] {
  const seen = new Set<string>();
  const sources: ChatSource[] = [];
  for (const item of items) {
    if (seen.has(item.documentId)) continue;
    seen.add(item.documentId);
    sources.push({
      documentId: item.documentId,
      title: item.title,
      chapter: item.chapter,
    });
  }
  return sources;
}

function clip(text: string, max: number) {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join('')}…`;
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}
