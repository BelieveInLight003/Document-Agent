import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  end: vi.fn(),
}));
vi.mock('langsmith/run_trees', () => ({
  RunTree: class MockRunTree {
    postRun = mocks.post;
    patchRun = mocks.patch;
    end = mocks.end;
    createChild() {
      return new MockRunTree();
    }
  },
}));
vi.mock('langsmith/traceable', () => ({
  getCurrentRunTree: () => undefined,
  withRunTree: (_tree: unknown, fn: () => unknown) => fn(),
}));
vi.mock('langsmith/experimental/vercel', () => ({
  wrapAISDK: (sdk: unknown) => sdk,
}));
vi.mock('./langfuse.js', () => ({
  enableLangfuse: () => false,
  insideLangfuseTrace: () => false,
  openLangfuseTrace: () => undefined,
  runLangfuseSpan: vi.fn(),
}));

describe('tracing failure isolation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv('LANGSMITH_API_KEY', 'test-only');
    vi.stubEnv('LANGCHAIN_API_KEY', 'test-only');
    mocks.post.mockResolvedValue(undefined);
    mocks.patch.mockResolvedValue(undefined);
    mocks.end.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('returns successful work even when trace patching fails', async () => {
    mocks.patch.mockRejectedValue(new Error('trace offline'));
    const { startChatTrace } = await import('./langsmith.js');
    const action = vi.fn().mockResolvedValue('answer');
    const trace = startChatTrace('test', {});
    expect(
      await trace.span('step', 'chain', {}, action, (answer) => ({ answer })),
    ).toBe('answer');
    expect(action).toHaveBeenCalledOnce();
    await trace.end({});
  });
  it('does not run business work twice when trace setup is unavailable', async () => {
    mocks.post.mockRejectedValue(new Error('trace offline'));
    const { startChatTrace } = await import('./langsmith.js');
    const action = vi.fn().mockResolvedValue('answer');
    expect(
      await startChatTrace('test', {}).span(
        'step',
        'chain',
        {},
        action,
        () => ({}),
      ),
    ).toBe('answer');
    expect(action).toHaveBeenCalledOnce();
  });
  it('preserves the original business error when trace ending also fails', async () => {
    mocks.end.mockRejectedValue(new Error('trace error'));
    const { startChatTrace } = await import('./langsmith.js');
    const action = vi
      .fn()
      .mockRejectedValue(new Error('original business error'));
    await expect(
      startChatTrace('test', {}).span('step', 'chain', {}, action, () => ({})),
    ).rejects.toThrow('original business error');
    expect(action).toHaveBeenCalledOnce();
  });
});
