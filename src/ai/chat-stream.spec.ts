import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ loop: vi.fn(), stream: vi.fn() }));
vi.mock('./agent-loop.js', () => ({ runAgentLoop: mocks.loop }));
vi.mock('./chat-model.js', () => ({ createChatModel: () => ({}) }));
vi.mock('./langsmith.js', () => ({ tracedStreamText: mocks.stream }));
import { createAnswerStream, promptOf } from './chat-stream.js';

describe('answer generation and persistence status', () => {
  beforeEach(() => vi.resetAllMocks());
  it('includes long-term memory in ordinary knowledge answers', () => {
    const [, prompt] = promptOf(
      'answer',
      'question',
      [],
      '',
      'remembered preference',
    );
    expect(prompt).toContain('remembered preference');
  });
  it('records a provider error as failed instead of a successful refusal', async () => {
    mocks.loop.mockResolvedValue({
      outcome: 'chat',
      items: [],
      query: '',
      intent: 'chat',
    });
    mocks.stream.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'error', error: new Error('provider failure') };
      })(),
    });
    const onEnd = vi.fn().mockResolvedValue(undefined);
    const stream = createAnswerStream({
      question: 'hello',
      searchQuestion: 'hello',
      memory: '',
      contextLabel: '',
      limit: 5,
      abortSignal: new AbortController().signal,
      retrieve: vi.fn(),
      retrieveGraph: vi.fn(),
      retrieveWeb: vi.fn(),
      recall: vi.fn().mockResolvedValue({ text: '', count: 0 }),
      trace: {
        span: async (
          _name: unknown,
          _kind: unknown,
          _args: unknown,
          fn: () => Promise<unknown>,
        ) => fn(),
        end: vi.fn(),
      } as never,
      onEnd,
    });
    const reader = stream.getReader();
    while (!(await reader.read()).done) {}
    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        answer: '对话暂时不可用，请稍后再试。',
      }),
    );
  });
});
