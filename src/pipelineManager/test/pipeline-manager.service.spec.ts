import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  index: vi.fn(),
  remove: vi.fn(),
  graph: vi.fn(),
  split: vi.fn(),
}));
vi.mock('../embedding.js', () => ({ embedChunks: mocks.embed }));
vi.mock('../vector-index.js', () => ({
  indexEmbeddedChunks: mocks.index,
  deleteDocumentChunks: mocks.remove,
}));
vi.mock('../graph.js', () => ({
  prepareDocumentGraph: mocks.graph,
  deleteDocumentGraph: vi.fn(),
}));
vi.mock('../es-document.js', () => ({
  indexEsDocument: vi.fn(),
  deleteEsDocument: vi.fn(),
}));
vi.mock('../chunk.js', () => ({ splitToChunks: mocks.split }));
import { PipelineManagerService } from '../pipeline-manager.service.js';

const message = {
  jobId: '00000000-0000-4000-8000-000000000001',
  documentId: '123',
  contentId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  title: 'policy',
  publishedAt: '2026-11-12T00:00:00.000Z',
};
function setup() {
  const handlers: Record<string, (message: unknown) => Promise<unknown>> = {};
  const mq = {
    subscribe: vi.fn((fn) => {
      handlers.vector = fn;
    }),
    subscribeKeyword: vi.fn((fn) => {
      handlers.keyword = fn;
    }),
    subscribeGraph: vi.fn((fn) => {
      handlers.graph = fn;
    }),
    publish: vi.fn(),
    publishKeyword: vi.fn(),
    publishGraph: vi.fn(),
  };
  const manager = {
    query: vi.fn().mockResolvedValue([{ status: 'queued' }]),
    findOne: vi.fn().mockResolvedValue({
      contentId: message.contentId,
      status: 1,
      deleted: false,
      publishTime: new Date(message.publishedAt),
    }),
  };
  const data = {
    query: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (fn) => fn(manager)),
  };
  const model = {
    findOne: vi.fn(() => ({ lean: async () => ({ content: 'body' }) })),
  };
  const service = new PipelineManagerService(
    mq as never,
    model as never,
    data as never,
  );
  return { service, handlers, mq, manager, data, model };
}
describe('durable pipeline jobs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.embed.mockResolvedValue([
      { id: 'c1', content: 'body', embedding: [1] },
    ]);
    mocks.split.mockResolvedValue([{ id: 'c1', content: 'body' }]);
  });
  it('enqueues all three jobs in the caller transaction without publishing early', async () => {
    const { service, manager, mq } = setup();
    await service.publishDocument(message, manager as never);
    expect(manager.query).toHaveBeenCalledTimes(3);
    expect(mq.publish).not.toHaveBeenCalled();
    const payloads = manager.query.mock.calls.map(([, parameters]) =>
      JSON.parse(parameters[3]),
    );
    expect(new Set(payloads.map((payload) => payload.jobId)).size).toBe(3);
    expect(
      payloads.every((payload) => payload.contentId === message.contentId),
    ).toBe(true);
  });
  it('discards an outdated body version before running expensive extraction', async () => {
    const { service, handlers, manager, model } = setup();
    await service.onModuleInit();
    manager.findOne.mockResolvedValue({
      status: 1,
      deleted: false,
      contentId: 'new-version',
      publishTime: new Date(message.publishedAt),
    });
    await handlers.vector(message);
    expect(model.findOne).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE kh_pipeline_job'),
      [message.jobId, 'obsolete'],
    );
  });
  it('ignores a duplicate completed job', async () => {
    const { service, handlers, manager } = setup();
    await service.onModuleInit();
    manager.query.mockResolvedValue([{ status: 'completed' }]);
    await handlers.vector(message);
    expect(mocks.index).not.toHaveBeenCalled();
  });
  it('persists processing failure for retry instead of losing the job', async () => {
    const { service, handlers, data } = setup();
    await service.onModuleInit();
    mocks.embed.mockRejectedValue(new Error('embedding unavailable'));
    await handlers.vector(message);
    expect(data.query).toHaveBeenLastCalledWith(
      expect.stringContaining('attempts = attempts + 1'),
      [message.jobId, 'embedding unavailable'],
    );
  });
  it('does not let an old deletion remove a republished document', async () => {
    const { service, handlers } = setup();
    await service.onModuleInit();
    await handlers.vector({ ...message, action: 'delete' });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('marks a matching successful index job completed', async () => {
    const { service, handlers, manager } = setup();
    await service.onModuleInit();
    await handlers.vector(message);
    expect(mocks.index).toHaveBeenCalled();
    expect(manager.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE kh_pipeline_job'),
      [message.jobId, 'completed'],
    );
  });
  it('rechecks the version after extraction and skips stale writes', async () => {
    const { service, handlers, manager } = setup();
    await service.onModuleInit();
    mocks.embed.mockImplementation(async () => {
      manager.findOne.mockResolvedValue({
        status: 1,
        deleted: false,
        contentId: 'new-body',
        publishTime: new Date(message.publishedAt),
      });
      return [{ id: 'c1', embedding: [1] }];
    });
    await handlers.vector(message);
    expect(mocks.index).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE kh_pipeline_job'),
      [message.jobId, 'obsolete'],
    );
  });
  it('retains an outbox event when the broker is unavailable', async () => {
    const { service, manager, mq } = setup();
    manager.query
      .mockResolvedValueOnce([
        { id: message.jobId, kind: 'published', payload: message },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mq.publish.mockRejectedValue(new Error('broker offline'));
    await service.flush();
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending'"),
      [message.jobId, 'broker offline'],
    );
  });
});
