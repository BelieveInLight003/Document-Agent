import {
  createUIMessageStream,
  type UIMessage,
} from 'ai';
import { runAgentLoop } from './agent-loop.js';
import { citedItems, citedSources } from './agent-grade.js';
import type { HybridHitView } from './ai.view.js';
import { createChatModel } from './chat-model.js';
import type { ChatStep } from './chat-step.js';
import type { ChatTrace } from './langsmith.js';
import { tracedStreamText } from './langsmith.js';
import { answerPrompt, chatPrompt, preferencePrompt, UNANSWERABLE } from './prompt.js';

type AnswerMessage = UIMessage<unknown, { step: ChatStep }>;

const ANSWER_PART = 'answer';

export function createAnswerStream(input: {
  /** 用户原话，用来展示和写入会话记录。 */
  question: string;
  /** 指代改写后的问题。意图路由还会再给出检索词。 */
  searchQuestion: string;
  /** 摘要加最近对话。没有上文时是空字符串。 */
  memory: string;
  /** 改写指代时用到的上下文，例如「上文」或「上文和长期记忆」。 */
  contextLabel: string;
  limit: number;
  abortSignal: AbortSignal;
  retrieve: (question: string, limit: number) => Promise<HybridHitView[]>;
  /** 知识图谱。失败时应抛出，决策链会记成图谱不可用并继续用文档结果。 */
  retrieveGraph: (question: string, limit: number) => Promise<HybridHitView[]>;
  /** 博查联网检索。未配置或失败时应抛出。 */
  retrieveWeb: (question: string, limit: number) => Promise<HybridHitView[]>;
  /** 和文档检索一起做。失败时应返回空文本，不要抛出。 */
  recall: (question: string) => Promise<{ text: string; count: number }>;
  /** 本次提问的 LangSmith 记录。没有密钥时是空实现。 */
  trace: ChatTrace;
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
      const generate = async (instructions: string, prompt: string, span: Record<string, unknown>) => {
        let started = false;
        let aborted = false;
        await input.trace.span(
          '生成回答',
          'llm',
          span,
          async () => {
            try {
              const result = tracedStreamText({
                model: createChatModel(),
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
                aborted = true;
                if (started) writer.write({ type: 'text-end', id: ANSWER_PART });
                if (!answer.trim()) answer = '回答已中断。';
                return answer;
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
            return answer;
          },
          (text) => ({ answer: text }),
        );
        return aborted;
      };

      writer.write({ type: 'start' });
      writer.write({ type: 'start-step' });
      const short = clip(input.question, 24);
      const rewritten = input.searchQuestion !== input.question;
      publish({
        id: 'organize',
        kind: 'fold',
        title: `整理「${short}」`,
        detail: rewritten
          ? `问题里的指代不清楚，已结合${input.contextLabel}改写为：${input.searchQuestion}`
          : '我先确认要查的对象和范围。',
        status: 'done',
      });

      let longTerm = '';
      try {
        const recalled = await input.recall(input.searchQuestion);
        longTerm = recalled.text;
      } catch {
        longTerm = '';
      }
      if (input.abortSignal.aborted) {
        answer = '回答已中断。';
        finish('aborted');
        return;
      }

      const loop = await runAgentLoop({
        question: input.searchQuestion,
        memory: input.memory,
        longTerm,
        limit: input.limit,
        signal: input.abortSignal,
        trace: input.trace,
        retrieve: input.retrieve,
        retrieveGraph: input.retrieveGraph,
        retrieveWeb: input.retrieveWeb,
        onStep: publish,
      });
      if (loop.outcome === 'aborted') {
        answer = '回答已中断。';
        finish('aborted');
        return;
      }
      if (loop.outcome === 'unavailable') {
        publish({
          id: 'sources',
          kind: 'sources',
          title: '检索失败',
          detail: '文档和图谱都暂时不可用。',
          status: 'done',
          sources: [],
        });
        publish({ id: 'done', kind: 'done', title: '已完成', status: 'done' });
        writeText('文档和图谱都暂时不可用，请稍后再试。');
        finish('completed');
        return;
      }
      if (loop.outcome === 'refuse' || (loop.outcome === 'answer' && loop.items.length === 0)) {
        const refused = refuseCopy(loop.refuseReason);
        publish({
          id: 'plan',
          kind: 'plan',
          title: '整理回答',
          detail: refused.detail,
          status: 'done',
        });
        publish({
          id: 'sources',
          kind: 'sources',
          title: '没有可引用的资料',
          detail: '评估没有通过的资料不会展示。',
          status: 'done',
          sources: [],
        });
        publish({ id: 'done', kind: 'done', title: '已完成', status: 'done' });
        writeText(refused.text);
        finish('completed');
        return;
      }

      if (loop.outcome === 'preference' && !longTerm.trim() && !input.memory.trim()) {
        publish({
          id: 'plan',
          kind: 'plan',
          title: '整理回答',
          detail: '没有已确认的个人偏好，我会直接说明。',
          status: 'done',
        });
        publish({ id: 'done', kind: 'done', title: '已完成', status: 'done' });
        writeText(UNANSWERABLE);
        finish('completed');
        return;
      }

      const evidence = loop.items;
      publish({
        id: 'plan',
        kind: 'plan',
        title: '整理回答',
        detail: planDetail(loop.outcome, evidence),
        status: 'done',
      });
      publish({ id: 'done', kind: 'done', title: '已完成', status: 'done' });

      const aborted = await generate(
        ...promptOf(loop.outcome, input.searchQuestion, evidence, input.memory, longTerm),
        {
          intent: loop.outcome,
          query: loop.query,
          documentCount: evidence.length,
        },
      );
      if (aborted) {
        finish('aborted');
        return;
      }

      if (loop.outcome === 'answer') {
        items = citedItems(evidence, answer);
        const sources = citedSources(evidence, answer);
        publish({
          id: 'sources',
          kind: 'sources',
          title: sources.length === 0 ? '没有可引用的资料' : `引用 ${sources.length} 条资料`,
          detail: sources.length === 0 ? '回答没有标出资料编号。' : undefined,
          status: 'done',
          sources,
        });
      }
      finish('completed');
    },
    onEnd: async ({ isAborted }) => {
      if (persisted) return;
      persisted = true;
      const content = answer.trim() || (isAborted ? '回答已中断。' : '');
      await input.onEnd({
        answer: content,
        items,
        steps: [...steps],
        aborted: isAborted || input.abortSignal.aborted,
      });
    },
  });
}

function promptOf(
  outcome: string,
  question: string,
  items: HybridHitView[],
  memory: string,
  longTerm: string,
): [string, string] {
  if (outcome === 'chat') {
    const prompt = chatPrompt(question);
    return [prompt.instructions, prompt.prompt];
  }
  if (outcome === 'preference') {
    const prompt = preferencePrompt(question, memory, longTerm);
    return [prompt.instructions, prompt.prompt];
  }
  const prompt = answerPrompt(question, items, memory);
  return [prompt.instructions, prompt.prompt];
}

function planDetail(outcome: string, items: HybridHitView[]) {
  if (outcome === 'chat') return '这一问不查知识库，我直接回复。';
  if (outcome === 'preference') return '这一问只根据已确认的长期记忆回答。';
  const web = items.filter((item) => item.channels.includes('web')).length;
  const graph = items.filter((item) => item.channels.includes('graph')).length;
  const docs = items.length - web - graph;
  if (web && !graph && !docs) return `网页资料已评估为切题，我将根据这 ${web} 条网页回答，并标出 [n]。`;
  if (graph && docs) return `文档和图谱都已评估为切题，我将根据这 ${items.length} 条资料回答，并标出 [n]。`;
  if (graph) return `图谱关系已评估为切题，我将根据这 ${graph} 条关系回答，并标出 [n]。`;
  return `资料已评估为切题，我将根据 ${items.length} 条资料回答，并标出 [n]。`;
}

function refuseCopy(reason: 'knowledge' | 'web-insufficient' | 'web-unavailable' | 'web-off' | undefined) {
  if (reason === 'web-unavailable') {
    return { detail: '联网检索暂时不可用，我会直接说明。', text: '联网检索暂时不可用，请稍后再试。' };
  }
  if (reason === 'web-off') {
    return { detail: '联网检索还不可用，我会直接说明。', text: UNANSWERABLE };
  }
  if (reason === 'web-insufficient') {
    return { detail: '网页资料也不足以回答，我会直接说明。', text: UNANSWERABLE };
  }
  return { detail: '知识库里没有能支撑回答的内容，我会直接说明。', text: UNANSWERABLE };
}

function clip(text: string, max: number) {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join('')}…`;
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}
