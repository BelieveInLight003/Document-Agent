import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  bulk: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@elastic/elasticsearch', () => ({
  Client: class {
    indices = { exists: mocks.exists };
    bulk = mocks.bulk;
    deleteByQuery = mocks.remove;
  },
}));
import { indexEmbeddedChunks } from '../vector-index.js';

describe('vector index replacement', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.exists.mockResolvedValue(true);
    process.env.ELASTICSEARCH_ENABLED = 'true';
  });
  const data = {
    documentId: '1',
    contentId: 'body',
    chunks: [
      {
        id: '1:body:0',
        title: 'policy',
        content: 'new policy',
        embedding: [1],
      },
    ],
  };
  it('keeps existing evidence if new indexing fails', async () => {
    mocks.bulk.mockResolvedValue({
      errors: true,
      items: [{ index: { error: { reason: 'failed' } } }],
    });
    await expect(indexEmbeddedChunks(data)).rejects.toThrow('failed');
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('removes superseded chunks only after successful indexing', async () => {
    mocks.bulk.mockResolvedValue({ errors: false });
    await indexEmbeddedChunks(data);
    expect(mocks.bulk.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.remove.mock.invocationCallOrder[0],
    );
    expect(mocks.remove.mock.calls[0][0].query.bool.must_not).toEqual([
      { terms: { chunkId: ['1:body:0'] } },
    ]);
  });
});
