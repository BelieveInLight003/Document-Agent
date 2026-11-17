import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HybridHitView } from './ai.view.js';
const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  grade: vi.fn(),
  rewrite: vi.fn(),
  enabled: vi.fn(),
}));
vi.mock('./agent-route.js', () => ({
  routeQuestion: mocks.route,
  INTENT_LABEL: { knowledge: 'knowledge', web: 'web' },
}));
vi.mock('./agent-grade.js', () => ({
  gradeHits: mocks.grade,
  rewriteSearchQuery: mocks.rewrite,
  rewriteWebQuery: mocks.rewrite,
  webSearchEnabled: mocks.enabled,
  webSearchDisabledReason: () => 'disabled',
  GRADE_LABEL: {
    partial: 'partial',
    sufficient: 'sufficient',
    unavailable: 'unavailable',
    empty: 'empty',
  },
}));
import { runAgentLoop } from './agent-loop.js';

const hit = (id: string): HybridHitView => ({
  chunkId: id,
  documentId: '1',
  contentId: 'body',
  title: 'policy',
  chapter: null,
  content: id,
  score: 1,
  channels: ['keyword'],
});
function input() {
  return {
    question: 'who approves and when is payment',
    memory: '',
    longTerm: '',
    limit: 5,
    signal: new AbortController().signal,
    trace: {
      span: async (
        _name: unknown,
        _kind: unknown,
        _args: unknown,
        fn: () => Promise<unknown>,
      ) => fn(),
      end: vi.fn(),
    } as never,
    retrieve: vi.fn(),
    retrieveGraph: vi.fn().mockResolvedValue([]),
    retrieveWeb: vi.fn(),
    onStep: vi.fn(),
  };
}
describe('agent decision chain', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.route.mockResolvedValue({ intent: 'knowledge', query: 'approval' });
    mocks.enabled.mockReturnValue(false);
    mocks.rewrite.mockResolvedValue('payment');
  });
  it('combines partial evidence from both rounds before deciding', async () => {
    const data = input();
    data.retrieve
      .mockResolvedValueOnce([hit('approver')])
      .mockResolvedValueOnce([hit('payment')]);
    mocks.grade
      .mockResolvedValueOnce({ grade: 'partial', reason: 'need payment time' })
      .mockResolvedValueOnce({ grade: 'sufficient', reason: 'both covered' });
    const result = await runAgentLoop(data);
    expect(result.outcome).toBe('answer');
    expect(result.items.map((item) => item.chunkId)).toEqual([
      'approver',
      'payment',
    ]);
    expect(mocks.grade.mock.calls[1][1]).toHaveLength(2);
  });
  it('does not rewrite or search the web when the evaluator is unavailable', async () => {
    const data = input();
    data.retrieve.mockResolvedValue([hit('approver')]);
    mocks.grade.mockResolvedValue({
      grade: 'unavailable',
      reason: 'model unavailable',
    });
    expect((await runAgentLoop(data)).outcome).toBe('unavailable');
    expect(mocks.rewrite).not.toHaveBeenCalled();
    expect(data.retrieveWeb).not.toHaveBeenCalled();
  });
  it('does not claim no evidence when a channel fails and the other is empty', async () => {
    const data = input();
    data.retrieve.mockRejectedValue(new Error('unavailable'));
    expect((await runAgentLoop(data)).outcome).toBe('unavailable');
  });
  it('preserves internal evidence when adding public web evidence', async () => {
    mocks.enabled.mockReturnValue(true);
    const data = input();
    data.retrieve.mockResolvedValue([hit('internal')]);
    data.retrieveWeb.mockResolvedValue([
      { ...hit('public'), documentId: '', channels: ['web'] },
    ]);
    mocks.rewrite.mockResolvedValue('approval');
    mocks.grade
      .mockResolvedValueOnce({ grade: 'partial', reason: 'need public data' })
      .mockResolvedValueOnce({ grade: 'sufficient', reason: 'combined' });
    const result = await runAgentLoop(data);
    expect(result.items.map((item) => item.chunkId)).toEqual([
      'internal',
      'public',
    ]);
  });
});
