import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PipelineManagerService } from '../pipelineManager/pipeline-manager.service.js';
import { DocumentStatus } from './document-status.js';
import { ReviewStatus } from './document-review-status.js';
import { ApproveReviewDto } from './dto/approve-review.dto.js';
import { PendingReviewQueryDto } from './dto/pending-review-query.dto.js';
import { RejectReviewDto } from './dto/reject-review.dto.js';
import { SubmitReviewDto } from './dto/submit-review.dto.js';
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
   * 再次提交时如果当前是已发布，先删掉向量索引、全文索引和图谱。
   */
  async submit(documentId: string, dto: SubmitReviewDto) {
    const document = await this.findDocument(documentId);
    if (!submitableStatuses.includes(document.status)) {
      throw new BadRequestException('只有草稿或已发布的文档可以提交审核');
    }

    const pending = await this.findPending(document.id);
    if (pending) {
      throw new BadRequestException('该文档已有待审核记录');
    }

    const wasPublished = document.status === DocumentStatus.PUBLISHED;
    if (wasPublished) {
      await this.pipelineManagerService.removeDocument(document.id.toString());
    }

    const review = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(DocumentReview, {
          documentId: document.id,
          submitterId: this.toBigint(dto.submitterId),
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
      return saved;
    });

    return { review: this.serialize(review), cleared: wasPublished };
  }

  /** 按审核单 taskId 找到文档，驳回后文档回到草稿。 */
  async reject(taskId: string, dto: RejectReviewDto) {
    const review = await this.findPendingReview(taskId);
    const document = await this.findDocument(review.documentId.toString());
    const opinion = dto.opinion.trim();
    if (!opinion) {
      throw new BadRequestException('审核意见不能为空');
    }
    const now = new Date();

    // dataSource 是当前 Postgres 连接。transaction 打开一个事务，
    // manager 只在这个事务里保存，文档改回草稿和审核单驳回要么一起成功，要么一起回滚。
    const saved = await this.dataSource.transaction(async (manager) => {
      review.reviewerId = this.toBigint(dto.reviewerId);
      review.opinion = opinion;
      review.reviewStatus = ReviewStatus.REJECTED;
      review.statusAfter = DocumentStatus.DRAFT;
      review.updatedAt = now;
      document.status = DocumentStatus.DRAFT;
      if (dto.reviewerId) {
        document.updateBy = this.toBigint(dto.reviewerId);
      }
      await manager.save(document);
      return manager.save(review);
    });
    return { review: this.serialize(saved) };
  }

  /** 按审核单 taskId 找到文档，通过后变为已发布，并按当前正文重建三个索引。 */
  async approve(taskId: string, dto: ApproveReviewDto) {
    const review = await this.findPendingReview(taskId);
    const document = await this.findDocument(review.documentId.toString());
    const documentIdText = document.id.toString();
    const wasPublished = review.statusBefore === DocumentStatus.PUBLISHED;

    const publishedAt = new Date();
    await this.pipelineManagerService.publishDocument({
      documentId: documentIdText,
      contentId: document.contentId,
      title: document.title,
      publishedAt: publishedAt.toISOString(),
    });

    review.reviewerId = this.toBigint(dto.reviewerId);
    review.opinion = dto.opinion?.trim() || review.opinion;
    review.reviewStatus = ReviewStatus.APPROVED;
    review.statusAfter = DocumentStatus.PUBLISHED;
    review.approvedAt = publishedAt;
    review.updatedAt = publishedAt;
    document.status = DocumentStatus.PUBLISHED;
    document.publishTime = publishedAt;
    if (dto.reviewerId) {
      document.updateBy = this.toBigint(dto.reviewerId);
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      await manager.save(document);
      return manager.save(review);
    });
    return {
      review: this.serialize(saved),
      rebuilt: wasPublished,
    };
  }

  /** 已发布改为归档，并清掉向量索引、全文索引和图谱。正文仍留在库里。 */
  async archive(documentId: string) {
    const document = await this.findDocument(documentId);
    if (document.status === DocumentStatus.ARCHIVED) {
      throw new BadRequestException('文档已归档');
    }
    if (document.status !== DocumentStatus.PUBLISHED) {
      throw new BadRequestException('只有已发布的文档可以归档');
    }

    await this.pipelineManagerService.removeDocument(document.id.toString());
    document.status = DocumentStatus.ARCHIVED;
    const saved = await this.documentRepository.save(document);
    return {
      id: saved.id.toString(),
      status: saved.status,
    };
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
  async listByDocument(documentId: string) {
    const document = await this.findDocument(documentId);
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
  private async findPendingReview(taskId: string) {
    const review = await this.findReview(taskId);
    if (review.reviewStatus !== ReviewStatus.PENDING) {
      throw new BadRequestException('该审核单不是待审核');
    }
    return review;
  }

  private async findReview(taskId: string) {
    if (!/^\d+$/.test(taskId)) {
      throw new BadRequestException('审核 ID 无效');
    }
    const review = await this.reviewRepository.findOne({
      where: { id: BigInt(taskId) },
    });
    if (!review) {
      throw new NotFoundException('审核记录不存在');
    }
    return review;
  }

  private findPending(documentId: bigint) {
    return this.reviewRepository.findOne({
      where: {
        documentId,
        reviewStatus: ReviewStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async findDocument(id: string) {
    if (!/^\d+$/.test(id)) {
      throw new BadRequestException('文档 ID 无效');
    }
    const document = await this.documentRepository.findOne({
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
      titles.set(document.id.toString(), document.title);
    }
    return titles;
  }

  private toBigint(value?: string) {
    return value ? BigInt(value) : null;
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
