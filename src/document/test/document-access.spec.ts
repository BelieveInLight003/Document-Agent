import { describe, expect, it } from 'vitest';
import {
  canReadDocument,
  canViewDocument,
  canEditDocument,
  readableDocumentWhere,
} from '../document-access.js';
import { DocumentStatus } from '../document-status.js';

const viewer = { userId: '1', roles: ['ROLE_USER'] };
const document = {
  status: DocumentStatus.PUBLISHED,
  deleted: false,
  isPublic: false,
  authorId: '2',
};

describe('document authorization', () => {
  it('denies another author private document across view, retrieval and edit', () => {
    expect(canReadDocument(viewer, document)).toBe(false);
    expect(canViewDocument(viewer, document)).toBe(false);
    expect(canEditDocument(viewer, document)).toBe(false);
  });
  it('allows public published documents to be read but not edited', () => {
    const publicDocument = { ...document, isPublic: true };
    expect(canReadDocument(viewer, publicDocument)).toBe(true);
    expect(canViewDocument(viewer, publicDocument)).toBe(true);
    expect(canEditDocument(viewer, publicDocument)).toBe(false);
  });
  it('allows an owner to view a draft without indexing it', () => {
    const draft = { ...document, authorId: '1', status: DocumentStatus.DRAFT };
    expect(canViewDocument(viewer, draft)).toBe(true);
    expect(canEditDocument(viewer, draft)).toBe(true);
    expect(canReadDocument(viewer, draft)).toBe(false);
  });
  it('does not expose another owner public draft', () => {
    expect(
      canViewDocument(viewer, {
        ...document,
        isPublic: true,
        status: DocumentStatus.DRAFT,
      }),
    ).toBe(false);
  });
  it('allows reviewers to read private drafts but not edit another owner document', () => {
    const reviewer = { userId: '3', roles: ['ROLE_REVIEWER'] };
    expect(
      canViewDocument(reviewer, { ...document, status: DocumentStatus.DRAFT }),
    ).toBe(true);
    expect(canEditDocument(reviewer, document)).toBe(false);
  });
  it('never exposes deleted documents, even to admins', () => {
    expect(
      canViewDocument(
        { userId: '3', roles: ['ROLE_ADMIN'] },
        { ...document, deleted: true },
      ),
    ).toBe(false);
  });
  it('prefilters retrieval using published public or owned documents', () => {
    expect(readableDocumentWhere(viewer)).toEqual([
      { status: DocumentStatus.PUBLISHED, deleted: false, isPublic: true },
      { status: DocumentStatus.PUBLISHED, deleted: false, authorId: 1n },
    ]);
  });
});
