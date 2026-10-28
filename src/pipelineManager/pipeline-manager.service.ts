import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DocumentContent,
  type DocumentContentDocument,
} from '../document/schema/document.content.schema.js';
import { MqService } from '../mq/mq.service.js';
import { splitToChunks } from './chunk.js';
import { embedChunks } from './embedding.js';
import { deleteEsDocument, indexEsDocument } from './es-document.js';
import { createDocumentGraph, deleteDocumentGraph } from './graph.js';
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
    this.mqService.subscribeKeyword((message: DocumentPublishedMessage) =>
      this.handleKeyword(message),
    );
    this.mqService.subscribeGraph((message: DocumentPublishedMessage) =>
      this.handleGraph(message),
    );
  }

  async publishDocument(message: DocumentPublishedMessage) {
    await this.mqService.publish(message);
    await this.mqService.publishKeyword(message);
    await this.mqService.publishGraph(message);
  }

  async removeDocument(documentId: string) {
    await deleteDocumentChunks(documentId);
    await deleteEsDocument(documentId);
    await deleteDocumentGraph(documentId);
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

  /** 不切片，把整篇正文写入 es_document，供关键词搜索。 */
  private async handleKeyword(message: DocumentPublishedMessage) {
    if (!message?.documentId || !message.contentId || !message.title?.trim()) {
      throw new Error('发布消息缺少 documentId、contentId 或 title');
    }

    const content = await this.loadContent(message.contentId);
    await indexEsDocument({
      documentId: message.documentId,
      contentId: message.contentId,
      title: message.title,
      content,
      publishedAt: message.publishedAt,
    });
    this.logger.log(
      `文档已写入关键词索引 documentId=${message.documentId} index=es_document`,
    );
  }

  /** 发布后的图谱：切片、抽取实体和关系，再写入 Neo4j。失败则抛错交给队列重试。 */
  private async handleGraph(message: DocumentPublishedMessage) {
    if (!message?.documentId || !message.contentId || !message.title?.trim()) {
      throw new Error('发布消息缺少 documentId、contentId 或 title');
    }

    const content = await this.loadContent(message.contentId);
    const result = await createDocumentGraph({
      documentId: message.documentId,
      contentId: message.contentId,
      title: message.title,
      publishedAt: message.publishedAt,
      content,
    });
    if (!result) {
      return;
    }
    this.logger.log(
      `文档已写入图谱 documentId=${message.documentId} chunks=${result.chunks} entities=${result.entities} relations=${result.relations}`,
    );
  }

  /** contentId 是 MongoDB document_content 的 _id。 */
  private async loadContent(contentId: string) {
    if (!Types.ObjectId.isValid(contentId)) {
      throw new Error('文档内容不存在');
    }
    const document = await this.documentContentModel
      .findOne({ _id: contentId, deleted: false })
      .lean();
    if (!document?.content?.trim()) {
      throw new Error('文档内容不存在');
    }
    return document.content;
  }
}
