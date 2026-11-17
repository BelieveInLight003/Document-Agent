import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  search: vi.fn(),
  embed: vi.fn(),
}));
vi.mock('../pipelineManager/vector-index.js', () => ({
  getChunkIndexTarget: () => ({
    index: 'chunks',
    client: { indices: { exists: mocks.exists }, search: mocks.search },
  }),
}));
vi.mock('../pipelineManager/embedding.js', () => ({
  createEmbeddings: () => ({ embedQuery: mocks.embed }),
}));
import { retrieveChunks } from './hybrid-retriever.js';

const source = {
  chunkId: 'c1',
  documentId: '1',
  contentId: 'body',
  content: 'policy',
};
describe('hybrid retrieval failures and prefiltering', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.exists.mockResolvedValue(true);
    mocks.embed.mockResolvedValue([1, 0]);
  });
  it('reports all-channel failure instead of no evidence', async () => {
    mocks.search.mockRejectedValue(new Error('search unavailable'));
    await expect(retrieveChunks('question', 5, ['body'])).rejects.toThrow(
      'All retrieval channels failed',
    );
  });
  it('keeps keyword results when embedding is down', async () => {
    mocks.embed.mockRejectedValue(new Error('embedding down'));
    mocks.search.mockResolvedValue({ hits: { hits: [{ _source: source }] } });
    expect(await retrieveChunks('question', 5, ['body'])).toHaveLength(1);
  });
  it('does not call an empty surviving channel proof of an empty library', async () => {
    mocks.embed.mockRejectedValue(new Error('embedding down'));
    mocks.search.mockResolvedValue({ hits: { hits: [] } });
    await expect(retrieveChunks('question', 5, ['body'])).rejects.toThrow(
      'degraded',
    );
  });
  it('filters both keyword and vector requests by authorized current content IDs', async () => {
    mocks.search.mockResolvedValue({ hits: { hits: [] } });
    await retrieveChunks('question', 5, ['body']);
    const requests = mocks.search.mock.calls.map(([request]) => request);
    expect(requests.find((request) => request.query).query.bool.filter).toEqual(
      [{ terms: { contentId: ['body'] } }],
    );
    expect(requests.find((request) => request.knn).knn.filter).toEqual({
      terms: { contentId: ['body'] },
    });
  });
  it('does not query external stores when no documents are readable', async () => {
    expect(await retrieveChunks('question', 5, [])).toEqual([]);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.exists).not.toHaveBeenCalled();
  });
  it('treats a missing index as a genuinely empty library', async () => {
    mocks.exists.mockResolvedValue(false);
    expect(await retrieveChunks('question', 5, ['body'])).toEqual([]);
  });
});
