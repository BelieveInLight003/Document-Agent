import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import {
  canEditDocument,
  canViewDocument,
  toDocumentAccess,
  type DocumentViewer,
} from './document-access.js';
import { lockDocument } from './document-lock.js';
import { PipelineManagerService } from '../pipelineManager/pipeline-manager.service.js';
import { DocumentStatus } from './document-status.js';
import { ReviewStatus } from './document-review-status.js';
import { ApproveReviewDto } from './dto/approve-review.dto.js';
import { PendingReviewQueryDto } from './dto/pending-review-query.dto.js';
import { RejectReviewDto } from './dto/reject-review.dto.js';
import { SubmitReviewDto } from './dto/submit-review.dto.js';
import { decodeUploadedText } from './decode-uploaded-text.js';
import { Document } from './entities/document.entity.js';
import { DocumentReview } from './entities/document-review.entity.js';

const submitableStatuses: number[] = [
  DocumentStatus.DRAFT,
  DocumentStatus.PUBLISHED,
];

/**
 * 文档审核。
 * 文档状态：0 草稿，1 已发布，2 归档，3 待审核。
 * 审核单状态：0 待审核，1 通过，2 驳回。
 */
@Injectable()
export class DocumentReviewService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocumentReview)
    private readonly reviewRepository: Repository<DocumentReview>,
    private readonly dataSource: DataSource,
    private readonly pipelineManagerService: PipelineManagerService,
  ) {}

  /**
   * 草稿或已发布可以提交。已有待审核记录时不能再提交。
   * 已发布文档提交后立即退出可检索范围，并在同一事务中登记索引清理任务。
   */
  async submit(
    documentId: string,
    _dto: SubmitReviewDto,
    viewer: DocumentViewer,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await lockDocument(manager, documentId);
      const document = await this.findDocument(documentId, manager);
      this.requireEdit(viewer, document);
      if (!submitableStatuses.includes(document.status)) {
        throw new BadRequestException('只有草稿或已发布的文档可以提交审核');
      }

      const pending = await manager.findOne(DocumentReview, {
        where: { documentId: document.id, reviewStatus: ReviewStatus.PENDING },
      });
      if (pending) {
        throw new BadRequestException('该文档已有待审核记录');
      }

      const wasPublished = document.status === DocumentStatus.PUBLISHED;
      if (wasPublished) {
        await this.pipelineManagerService.removeDocument(
          document.id.toString(),
          manager,
        );
      }

      const review = await manager.save(
        manager.create(DocumentReview, {
          documentId: document.id,
          submitterId: BigInt(viewer.userId),
          reviewerId: null,
          statusBefore: document.status,
          statusAfter: null,
          reviewStatus: ReviewStatus.PENDING,
          opinion: null,
          approvedAt: null,
        }),
      );
      document.status = DocumentStatus.PENDING_REVIEW;
      await manager.save(document);

      return { review: this.serialize(review), cleared: wasPublished };
    });
  }

  /** 按审核单 taskId 找到文档，驳回后文档回到草稿。 */
  async reject(taskId: string, dto: RejectReviewDto, viewer: DocumentViewer) {
    const existing = await this.findReview(taskId);
    return this.dataSource.transaction(async (manager) => {
      await lockDocument(manager, existing.documentId.toString());
      const review = await this.findPendingReview(taskId, manager);
      const document = await this.findDocument(
        review.documentId.toString(),
        manager,
      );
      if (document.status !== DocumentStatus.PENDING_REVIEW) {
        throw new BadRequestException('文档已退出审核状态');
      }
      const opinion = dto.opinion.trim();
      if (!opinion) {
        throw new BadRequestException('审核意见不能为空');
      }
      const now = new Date();

      review.reviewerId = BigInt(viewer.userId);
      review.opinion = opinion;
      review.reviewStatus = ReviewStatus.REJECTED;
      review.statusAfter = DocumentStatus.DRAFT;
      review.updatedAt = now;
      document.status = DocumentStatus.DRAFT;
      document.updateBy = BigInt(viewer.userId);
      await manager.save(document);
      const saved = await manager.save(review);
      return { review: this.serialize(saved) };
    });
  }

  /** 按审核单 taskId 找到文档，通过后变为已发布，并按当前正文重建三个索引。 */
  async approve(taskId: string, dto: ApproveReviewDto, viewer: DocumentViewer) {
    const existing = await this.findReview(taskId);
    return this.dataSource.transaction(async (manager) => {
      await lockDocument(manager, existing.documentId.toString());
      const review = await this.findPendingReview(taskId, manager);
      const document = await this.findDocument(
        review.documentId.toString(),
        manager,
      );
      if (document.status !== DocumentStatus.PENDING_REVIEW) {
        throw new BadRequestException('文档已退出审核状态');
      }
      const documentIdText = document.id.toString();
      const wasPublished = review.statusBefore === DocumentStatus.PUBLISHED;

      const publishedAt = new Date();
      document.title = decodeUploadedText(document.title);
      review.reviewerId = BigInt(viewer.userId);
      review.opinion = dto.opinion?.trim() || review.opinion;
      review.reviewStatus = ReviewStatus.APPROVED;
      review.statusAfter = DocumentStatus.PUBLISHED;
      review.approvedAt = publishedAt;
      review.updatedAt = publishedAt;
      document.status = DocumentStatus.PUBLISHED;
      document.publishTime = publishedAt;
      document.updateBy = BigInt(viewer.userId);

      await manager.save(document);
      await this.pipelineManagerService.publishDocument(
        {
          documentId: documentIdText,
          contentId: document.contentId,
          title: document.title,
          publishedAt: publishedAt.toISOString(),
        },
        manager,
      );
      const saved = await manager.save(review);
      return {
        review: this.serialize(saved),
        rebuilt: wasPublished,
      };
    });
  }

  /** 已发布改为归档，并清掉向量索引、全文索引和图谱。正文仍留在库里。 */
  async archive(documentId: string, viewer: DocumentViewer) {
    return this.dataSource.transaction(async (manager) => {
      await lockDocument(manager, documentId);
      const document = await this.findDocument(documentId, manager);
      this.requireEdit(viewer, document);
      if (document.status === DocumentStatus.ARCHIVED) {
        throw new BadRequestException('文档已归档');
      }
      if (document.status !== DocumentStatus.PUBLISHED) {
        throw new BadRequestException('只有已发布的文档可以归档');
      }

      await this.pipelineManagerService.removeDocument(
        document.id.toString(),
        manager,
      );
      document.status = DocumentStatus.ARCHIVED;
      const saved = await manager.save(document);
      return {
        id: saved.id.toString(),
        status: saved.status,
      };
    });
  }

  /** 待审核列表，附带文档标题。 */
  async listPending(query: PendingReviewQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const [rows, total] = await this.reviewRepository.findAndCount({
      where: { reviewStatus: ReviewStatus.PENDING },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const titles = await this.titlesOf(rows.map((row) => row.documentId));

    return {
      total,
      page,
      pageSize,
      list: rows.map((row) => ({
        ...this.serialize(row),
        title: titles.get(row.documentId.toString()) ?? null,
      })),
    };
  }

  /** 当前待审核的审核单数量。 */
  async countPending() {
    const count = await this.reviewRepository.count({
      where: { reviewStatus: ReviewStatus.PENDING },
    });
    return { count };
  }

  /** 一篇文档的审核记录，新的在前。 */
  async listByDocument(documentId: string, viewer: DocumentViewer) {
    const document = await this.findDocument(documentId);
    if (!canViewDocument(viewer, toDocumentAccess(document)))
      throw new NotFoundException('文档不存在');
    const rows = await this.reviewRepository.find({
      where: { documentId: document.id },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.serialize(row));
  }

  /** 按审核记录 id 查询。 */
  async findOne(reviewId: string) {
    return this.serialize(await this.findReview(reviewId));
  }

  /** 审核单必须是待审核，再用它上面的 documentId 去改文档。 */
  private async findPendingReview(taskId: string, manager?: EntityManager) {
    const review = await this.findReview(taskId, manager);
    if (review.reviewStatus !== ReviewStatus.PENDING) {
      throw new BadRequestException('该审核单不是待审核');
    }
    return review;
  }

  private async findReview(
    taskId: string,
    manager = this.reviewRepository.manager,
  ) {
    if (!/^\d+$/.test(taskId)) {
      throw new BadRequestException('审核 ID 无效');
    }
    const review = await manager.findOne(DocumentReview, {
      where: { id: BigInt(taskId) },
    });
    if (!review) {
      throw new NotFoundException('审核记录不存在');
    }
    return review;
  }

  private requireEdit(viewer: DocumentViewer, document: Document) {
    if (!canEditDocument(viewer, toDocumentAccess(document)))
      throw new ForbiddenException('不能修改其他用户的文档');
  }

  private async findDocument(
    id: string,
    manager = this.documentRepository.manager,
  ) {
    if (!/^\d+$/.test(id)) {
      throw new BadRequestException('文档 ID 无效');
    }
    const document = await manager.findOne(Document, {
      where: { id: BigInt(id), deleted: false },
    });
    if (!document) {
      throw new NotFoundException('文档不存在');
    }
    return document;
  }

  private async titlesOf(ids: bigint[]) {
    const titles = new Map<string, string>();
    if (ids.length === 0) {
      return titles;
    }
    const documents = await this.documentRepository.find({
      where: { id: In(ids) },
    });
    for (const document of documents) {
      titles.set(document.id.toString(), decodeUploadedText(document.title));
    }
    return titles;
  }

  private serialize(review: DocumentReview) {
    return {
      id: review.id.toString(),
      documentId: review.documentId.toString(),
      reviewerId: review.reviewerId?.toString() ?? null,
      submitterId: review.submitterId?.toString() ?? null,
      statusBefore: review.statusBefore,
      statusAfter: review.statusAfter,
      reviewStatus: review.reviewStatus,
      opinion: review.opinion,
      createdAt: review.createdAt,
      approvedAt: review.approvedAt,
      updatedAt: review.updatedAt,
    };
  }
}
