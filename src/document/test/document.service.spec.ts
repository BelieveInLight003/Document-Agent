import { describe, expect, it, vi } from 'vitest';
import { DocumentService } from '../document.service.js';
import { DocumentStatus } from '../document-status.js';

const viewer = { userId: '1', roles: ['ROLE_USER'] };
function setup(fields: Record<string, unknown> = {}) {
  const row = {
    id: 123n,
    authorId: 1n,
    status: DocumentStatus.DRAFT,
    title: 'policy',
    contentId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    deleted: false,
    isPublic: false,
    ...fields,
  };
  const manager = {
    query: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(row),
    save: vi.fn(async (value) => value),
  };
  const repo = {
    manager,
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => ({ id: 123n, ...value })),
    find: vi.fn(),
    findOne: vi.fn().mockResolvedValue(row),
  };
  const model = {
    findOne: vi.fn(() => ({
      lean: async () => ({
        _id: { toString: () => row.contentId },
        content: 'old',
        length: 3,
        contentSummary: 'old summary',
      }),
    })),
    find: vi.fn(() => ({ lean: async () => [] })),
    create: vi.fn().mockResolvedValue({
      _id: { toString: () => 'bbbbbbbbbbbbbbbbbbbbbbbb' },
    }),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
  };
  const pipeline = { publishDocument: vi.fn(), removeDocument: vi.fn() };
  const data = { transaction: vi.fn(async (fn) => fn(manager)) };
  const service = new DocumentService(
    model as never,
    repo as never,
    {} as never,
    pipeline as never,
    data as never,
  );
  return { service, row, repo, model, manager, pipeline };
}
describe('document service authorization and lifecycle', () => {
  it('does not fetch body for another author private document', async () => {
    const { service, model } = setup({ authorId: 2n });
    await expect(service.findOne('123', viewer)).rejects.toThrow('文档不存在');
    expect(model.findOne).not.toHaveBeenCalled();
  });
  it('filters private rows before fetching list bodies', async () => {
    const { service, row, repo, model } = setup({ authorId: 2n });
    repo.find.mockResolvedValue([row]);
    expect(await service.findAll(viewer)).toEqual([]);
    expect(model.find).not.toHaveBeenCalled();
  });
  it('assigns identity from the authenticated user', async () => {
    const { service, repo } = setup();
    await service.create(
      { title: 'policy', content: 'body', authorId: '2', createBy: '2' },
      viewer,
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: 1n,
        createBy: 1n,
        status: DocumentStatus.DRAFT,
      }),
    );
  });
  it('rejects creating an already published document', async () => {
    const { service, model } = setup();
    await expect(
      service.create(
        { title: 'policy', status: DocumentStatus.PUBLISHED },
        viewer,
      ),
    ).rejects.toThrow('草稿');
    expect(model.create).not.toHaveBeenCalled();
  });
  it('creates a new draft body version when editing published evidence', async () => {
    const { service, model, pipeline, manager } = setup({
      status: DocumentStatus.PUBLISHED,
    });
    const result = await service.update('123', { content: 'new' }, viewer);
    expect(result.document.status).toBe(DocumentStatus.DRAFT);
    expect(result.document.contentId).toBe('bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(model.updateOne).not.toHaveBeenCalled();
    expect(pipeline.removeDocument).toHaveBeenCalledWith('123', manager);
  });
  it('forbids a generic update from publishing a draft', async () => {
    const { service } = setup();
    await expect(
      service.update('123', { status: DocumentStatus.PUBLISHED }, viewer),
    ).rejects.toThrow('状态');
  });
  it('prevents owners bypassing approval with direct publish', async () => {
    const { service, pipeline } = setup();
    await expect(service.publish('123', viewer)).rejects.toThrow('审核');
    expect(pipeline.publishDocument).not.toHaveBeenCalled();
  });
  it('does not allow editing another author document', async () => {
    const { service } = setup({ authorId: 2n });
    await expect(
      service.update('123', { content: 'tampered' }, viewer),
    ).rejects.toThrow('其他用户');
  });
  it('removes a new body snapshot when the metadata transaction fails', async () => {
    const { service, model, manager } = setup();
    model.deleteOne.mockResolvedValue({});
    manager.save.mockRejectedValue(new Error('database failure'));
    await expect(
      service.update('123', { content: 'new' }, viewer),
    ).rejects.toThrow('database failure');
    expect(model.deleteOne).toHaveBeenCalledWith({
      _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(model.updateOne).not.toHaveBeenCalled();
  });
});
