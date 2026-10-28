import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import { DocumentReviewService } from './document-review.service.js';
import { ApproveReviewDto } from './dto/approve-review.dto.js';
import { PendingReviewQueryDto } from './dto/pending-review-query.dto.js';
import { RejectReviewDto } from './dto/reject-review.dto.js';
import { SubmitReviewDto } from './dto/submit-review.dto.js';

/** 文档审核接口。文档状态仍是草稿、已发布、归档、待审核四种。 */
@Controller('documents')
export class DocumentReviewController {
  constructor(private readonly documentReviewService: DocumentReviewService) {}

  /** 待审核数量。管理员和审核员可查。 */
  @Permissions(PermissionCode.DOCUMENT_REVIEW)
  @Get('reviews/pending/count')
  countPending() {
    return this.documentReviewService.countPending();
  }

  /** 待审核列表，可按页查询。管理员和审核员可查。 */
  @Permissions(PermissionCode.DOCUMENT_REVIEW)
  @Get('reviews/pending')
  listPending(@Query() query: PendingReviewQueryDto) {
    return this.documentReviewService.listPending(query);
  }

  /** 按审核记录 id 查询一条。 */
  @Permissions(PermissionCode.DOCUMENT_REVIEW)
  @Get('reviews/:reviewId')
  findOne(@Param('reviewId') reviewId: string) {
    return this.documentReviewService.findOne(reviewId);
  }

  /** 查询某篇文档的全部审核记录。 */
  @Permissions(PermissionCode.DOCUMENT, PermissionCode.DOCUMENT_LIST)
  @Get(':id/reviews')
  listByDocument(@Param('id') id: string) {
    return this.documentReviewService.listByDocument(id);
  }

  /** 提交审核。仅草稿或已发布；已发布的会先清掉三个索引。 */
  @Permissions(PermissionCode.DOCUMENT_CREATE)
  @Post(':id/review/submit')
  submit(@Param('id') id: string, @Body() dto: SubmitReviewDto) {
    return this.documentReviewService.submit(id, dto);
  }

  /** 驳回。参数是审核单 taskId，找到对应文档后改回草稿。审核意见必填。 */
  @Permissions(PermissionCode.DOCUMENT_REVIEW)
  @Post('reviews/:taskId/reject')
  reject(@Param('taskId') taskId: string, @Body() dto: RejectReviewDto) {
    return this.documentReviewService.reject(taskId, dto);
  }

  /** 通过。参数是审核单 taskId，找到对应文档后改为已发布并重建三个索引。 */
  @Permissions(PermissionCode.DOCUMENT_REVIEW)
  @Post('reviews/:taskId/approve')
  approve(@Param('taskId') taskId: string, @Body() dto: ApproveReviewDto) {
    return this.documentReviewService.approve(taskId, dto);
  }

  /** 归档。仅已发布可以归档，并清掉三个索引，正文保留。 */
  @Permissions(PermissionCode.DOCUMENT_EDIT)
  @Put(':id/archive')
  archive(@Param('id') id: string) {
    return this.documentReviewService.archive(id);
  }
}
