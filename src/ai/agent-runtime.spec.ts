import { describe, expect, it, vi } from 'vitest';
import {
  AgentBudgetError,
  AgentRuntime,
  modelRequestSettings,
  runAgentOperation,
} from './agent-runtime.js';

describe('agent runtime', () => {
  it('shares model and tool limits across nested steps', async () => {
    const runtime = new AgentRuntime(undefined, 5_000, { model: 1, tool: 1 });
    await runtime.run(async () => {
      modelRequestSettings();
      expect(() => modelRequestSettings()).toThrow(AgentBudgetError);
      await runAgentOperation(async () => 'ok');
      await expect(
        runAgentOperation(async () => 'never'),
      ).rejects.toBeInstanceOf(AgentBudgetError);
    });
  });
  it('cancels an operation while it is waiting', async () => {
    const abort = new AbortController();
    const runtime = new AgentRuntime(abort.signal);
    const pending = runtime.run(() =>
      runAgentOperation(() => new Promise(() => {})),
    );
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('does not start a tool when already cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    const work = vi.fn();
    await expect(
      new AgentRuntime(abort.signal).run(() => runAgentOperation(work)),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(work).not.toHaveBeenCalled();
  });
  it('enforces a tool timeout even when an SDK ignores cancellation', async () => {
    const keepAlive = setTimeout(() => {}, 1_000);
    try {
      await expect(
        runAgentOperation(() => new Promise(() => {}), 5),
      ).rejects.toMatchObject({ name: 'TimeoutError' });
    } finally {
      clearTimeout(keepAlive);
    }
  });
});
