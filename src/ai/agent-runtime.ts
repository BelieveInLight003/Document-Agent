import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<AgentRuntime>();

export class AgentBudgetError extends Error {
  constructor() {
    super('Agent call budget exhausted');
    this.name = 'AgentBudgetError';
  }
}

export class AgentRuntime {
  readonly signal: AbortSignal;
  private counts = { model: 0, tool: 0 };

  constructor(
    signal?: AbortSignal,
    totalMs = 120_000,
    private readonly limits = { model: 16, tool: 20 },
  ) {
    this.signal = AbortSignal.any([
      AbortSignal.timeout(totalMs),
      ...(signal ? [signal] : []),
    ]);
  }

  run<T>(fn: () => T): T {
    return storage.run(this, fn);
  }

  consume(kind: 'model' | 'tool') {
    this.signal.throwIfAborted();
    if (++this.counts[kind] > this.limits[kind]) throw new AgentBudgetError();
  }

  usage() {
    return { ...this.counts };
  }
}

export function currentRuntime() {
  return storage.getStore();
}

export function throwIfRunStopped(error?: unknown) {
  currentRuntime()?.signal.throwIfAborted();
  if (
    error instanceof AgentBudgetError ||
    (error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name))
  )
    throw error;
}

export function modelRequestSettings(signal?: AbortSignal) {
  const runtime = currentRuntime();
  runtime?.consume('model');
  return {
    abortSignal: AbortSignal.any([
      AbortSignal.timeout(30_000),
      ...(runtime ? [runtime.signal] : []),
      ...(signal ? [signal] : []),
    ]),
    maxRetries: 0,
    timeout: 30_000,
  };
}

/** Bounds even SDKs that do not accept cancellation, and removes listeners on completion. */
export async function runAgentOperation<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 20_000,
): Promise<T> {
  const runtime = currentRuntime();
  runtime?.consume('tool');
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(runtime ? [runtime.signal] : []),
  ]);
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return fn(signal);
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
