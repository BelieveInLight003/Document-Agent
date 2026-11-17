import { describe, expect, it, vi } from 'vitest';
import { DocumentReviewService } from '../document-review.service.js';
import { Document } from '../entities/document.entity.js';
import { DocumentStatus } from '../document-status.js';
import { ReviewStatus } from '../document-review-status.js';

function setup(status: number = DocumentStatus.DRAFT) {
  const row = {
    id: 123n,
    authorId: 1n,
    status,
    deleted: false,
    isPublic: false,
    contentId: 'body',
    title: 'policy',
  };
  let review: Record<string, unknown> | null = null;
  const manager = {
    query: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(async (entity) => (entity === Document ? row : review)),
    create: vi.fn((_entity, fields) => ({ id: 456n, ...fields })),
    save: vi.fn(async (value) => value),
  };
  const repo = { manager };
  const data = { transaction: vi.fn(async (fn) => fn(manager)) };
  const pipeline = { publishDocument: vi.fn(), removeDocument: vi.fn() };
  const service = new DocumentReviewService(
    repo as never,
    repo as never,
    data as never,
    pipeline as never,
  );
  return {
    service,
    row,
    manager,
    pipeline,
    pending: () => {
      review = {
        id: 456n,
        documentId: 123n,
        reviewStatus: ReviewStatus.PENDING,
        statusBefore: DocumentStatus.DRAFT,
      };
    },
  };
}

describe('document review transitions', () => {
  it('uses the authenticated submitter and hides published evidence in the same transaction', async () => {
    const { service, manager, pipeline, row } = setup(DocumentStatus.PUBLISHED);
    const result = await service.submit(
      '123',
      { submitterId: '999' },
      { userId: '1', roles: [] },
    );
    expect(result.review.submitterId).toBe('1');
    expect(row.status).toBe(DocumentStatus.PENDING_REVIEW);
    expect(pipeline.removeDocument).toHaveBeenCalledWith('123', manager);
  });
  it('does not let another owner submit a private document for review', async () => {
    const { service, manager } = setup();
    await expect(
      service.submit('123', {}, { userId: '2', roles: [] }),
    ).rejects.toThrow('其他用户');
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('saves approval and publication jobs through the same transaction manager', async () => {
    const { service, manager, pipeline, pending } = setup(
      DocumentStatus.PENDING_REVIEW,
    );
    pending();
    const result = await service.approve(
      '456',
      { reviewerId: '999' },
      { userId: '2', roles: ['ROLE_REVIEWER'] },
    );
    expect(result.review.reviewerId).toBe('2');
    expect(pipeline.publishDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: '123',
        contentId: 'body',
      }),
      manager,
    );
  });
  it('rejects a stale approval after the document has left review', async () => {
    const { service, pipeline, pending } = setup(DocumentStatus.ARCHIVED);
    pending();
    await expect(
      service.approve('456', {}, { userId: '2', roles: ['ROLE_REVIEWER'] }),
    ).rejects.toThrow('退出审核');
    expect(pipeline.publishDocument).not.toHaveBeenCalled();
  });
});
