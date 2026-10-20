import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DocumentContent,
  type DocumentContentDocument,
} from '../document/schema/document.content.schema.js';
import { MqService } from '../mq/mq.service.js';
import { splitToChunks } from './chunk.js';
import { embedChunks } from './embedding.js';
import { deleteDocumentChunks, indexEmbeddedChunks } from './vector-index.js';
import type { DocumentPublishedMessage } from './document-published.message.js';

/**
 * 文档发布后的业务处理。
 * 消息怎么进队列、怎么被消费，由 mq 模块负责。
 */
@Injectable()
export class PipelineManagerService implements OnModuleInit {
  private readonly logger = new Logger(PipelineManagerService.name);

  constructor(
    private readonly mqService: MqService,
    @InjectModel(DocumentContent.name)
    private readonly documentContentModel: Model<DocumentContentDocument>,
  ) {}

  onModuleInit() {
    this.mqService.subscribe((message: DocumentPublishedMessage) =>
      this.handlePublished(message),
    );
  }

  publishDocument(message: DocumentPublishedMessage) {
    return this.mqService.publish(message);
  }

  removeDocument(documentId: string) {
    return deleteDocumentChunks(documentId);
  }

  /**
   * 发布后的处理：取出正文，按配置切片，向量化，再写入 Elasticsearch。
   * 任一步失败都抛错，交给消息队列拒绝这条消息。
   */
  private async handlePublished(message: DocumentPublishedMessage) {
    if (!message?.documentId || !message.contentId || !message.title?.trim()) {
      throw new Error('发布消息缺少 documentId、contentId 或 title');
    }

    const content = await this.loadContent(message.contentId);
    const chunks = await splitToChunks(message.title, content);
    if (chunks.length === 0) {
      throw new Error('文档切分结果为空');
    }

    const embeddedChunks = await embedChunks(chunks);
    await indexEmbeddedChunks({
      documentId: message.documentId,
      contentId: message.contentId,
      chunks: embeddedChunks,
    });
    this.logger.log(
      `文档已写入向量索引 documentId=${message.documentId} chunks=${embeddedChunks.length}`,
    );
  }

  private async loadContent(contentId: string) {
    const document = await this.documentContentModel
      .findOne({ contentId, deleted: false })
      .lean();
    if (!document?.content?.trim()) {
      throw new Error('文档内容不存在');
    }
    return document.content;
  }
}
