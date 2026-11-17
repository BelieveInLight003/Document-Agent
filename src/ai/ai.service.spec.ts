import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock('./hybrid-retriever.js', () => ({ retrieveChunks: mocks.retrieve }));
vi.mock('./langsmith.js', () => ({
  insideTrace: () => true,
  startChatTrace: vi.fn(),
  hitTrace: vi.fn(),
  tracedGenerateText: vi.fn(),
}));
import { AiService } from './ai.service.js';

describe('retrieval authorization and content versions', () => {
  beforeEach(() => vi.resetAllMocks());
  it('passes allowed versions to search before candidate ranking', async () => {
    const repo = {
      find: vi
        .fn()
        .mockResolvedValueOnce([{ id: 1n, contentId: 'current-body' }]),
    };
    mocks.retrieve.mockResolvedValue([]);
    const service = new AiService(repo as never);
    await service.retrieve(
      { userId: '2', roles: ['ROLE_USER'] },
      { question: 'policy' },
    );
    expect(mocks.retrieve).toHaveBeenCalledWith('policy', 20, ['current-body']);
    expect(repo.find.mock.calls[0][0].where).toEqual([
      { status: 1, deleted: false, isPublic: true },
      { status: 1, deleted: false, authorId: 2n },
    ]);
  });
  it('rechecks current access and rejects stale indexed bodies', async () => {
    const row = {
      id: 1n,
      contentId: 'new-body',
      title: 'policy',
      authorId: 2n,
      status: 1,
      isPublic: true,
      deleted: false,
    };
    const repo = { find: vi.fn().mockResolvedValue([row]) };
    mocks.retrieve.mockResolvedValue([
      { documentId: '1', contentId: 'old-body', content: 'old policy' },
    ]);
    const service = new AiService(repo as never);
    expect(
      (
        await service.retrieve(
          { userId: '2', roles: [] },
          { question: 'policy' },
        )
      ).items,
    ).toEqual([]);
  });
});
