import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { Document } from '../document/entities/document.entity.js';
import { DocumentStatus } from '../document/document-status.js';
import { lockDocument } from '../document/document-lock.js';
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
import { prepareDocumentGraph, deleteDocumentGraph } from './graph.js';
import { deleteDocumentChunks, indexEmbeddedChunks } from './vector-index.js';
import type { DocumentPublishedMessage } from './document-published.message.js';

/**
 * 文档发布后的索引任务。
 * 正文仍在 MongoDB。这里的 SQL 都打在 kh_pipeline_job 上，用来记住「切片、全文、图谱还做没做完」。
 * 没有给这张表建实体，所以领取、改状态、重试都写成 SQL。消息的运输交给 mq。
 */
@Injectable()
export class PipelineManagerService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PipelineManagerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private flushing = false;

  constructor(
    private readonly mqService: MqService,
    @InjectModel(DocumentContent.name)
    private readonly documentContentModel: Model<DocumentContentDocument>,
    private readonly dataSource: DataSource,
  ) {}

  /** 启动时保证任务表存在，并登记三个队列的处理函数。此时还不发消息。 */
  async onModuleInit() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS kh_pipeline_job (
        id UUID PRIMARY KEY, document_id BIGINT NOT NULL, kind VARCHAR(20) NOT NULL,
        payload JSONB NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0, last_error TEXT,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.dataSource
      .query(`CREATE INDEX IF NOT EXISTS idx_pipeline_job_pending
      ON kh_pipeline_job (status, next_attempt_at)`);
    this.mqService.subscribe((message: DocumentPublishedMessage) =>
      this.processJob(message, () =>
        message.action === 'delete'
          ? Promise.resolve(() => deleteDocumentChunks(message.documentId))
          : this.handlePublished(message),
      ),
    );
    this.mqService.subscribeKeyword((message: DocumentPublishedMessage) =>
      this.processJob(message, () =>
        message.action === 'delete'
          ? Promise.resolve(() => deleteEsDocument(message.documentId))
          : this.handleKeyword(message),
      ),
    );
    this.mqService.subscribeGraph((message: DocumentPublishedMessage) =>
      this.processJob(message, () =>
        message.action === 'delete'
          ? Promise.resolve(() => deleteDocumentGraph(message.documentId))
          : this.handleGraph(message),
      ),
    );
  }

  /** 应用启动完成后每 5 秒把到期任务送进队列，并立刻先扫一轮。 */
  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      void this.flush().catch((error) => this.logger.error(error));
    }, 5_000);
    this.timer.unref();
    void this.flush().catch((error) => this.logger.error(error));
  }

  /** 关闭时停掉补投定时器。已经在队列里的消息不受影响。 */
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** 发布成功时调用。在调用方的事务里写入三条 action 为 index 的任务。 */
  async publishDocument(
    message: DocumentPublishedMessage,
    manager: EntityManager,
  ) {
    await this.enqueue({ ...message, action: 'index' }, manager);
  }

  /** 删除或退出发布时调用。同样写三条任务，action 为 delete，用来清掉三个索引。 */
  async removeDocument(documentId: string, manager: EntityManager) {
    await this.enqueue(
      {
        documentId,
        contentId: '',
        title: '',
        publishedAt: '',
        action: 'delete',
      },
      manager,
    );
  }

  /** 一次业务写三行：published、keyword、graph。三行各自有 jobId，互不影响。 */
  private async enqueue(
    message: DocumentPublishedMessage,
    manager: EntityManager,
  ) {
    for (const kind of ['published', 'keyword', 'graph']) {
      const jobId = randomUUID();
      await manager.query(
        `INSERT INTO kh_pipeline_job (id, document_id, kind, payload)
        VALUES ($1, $2, $3, $4::jsonb)`,
        [
          jobId,
          message.documentId,
          kind,
          JSON.stringify({ ...message, jobId }),
        ],
      );
    }
  }

  /** 管理员查看最近 100 条任务。只读，不改变状态。 */
  async listJobs() {
    return this.dataSource
      .query(`SELECT id, document_id, kind, status, attempts, last_error,
      created_at, updated_at FROM kh_pipeline_job ORDER BY created_at DESC LIMIT 100`);
  }

  /** 管理员手动重试。只接受 failed 或 queued，把任务拨回 pending，等下一轮 flush 再发。 */
  async retryJob(id: string) {
    return this.dataSource.query(
      `WITH retried AS (UPDATE kh_pipeline_job SET status = 'pending',
      attempts = 0, last_error = NULL, next_attempt_at = NOW(), updated_at = NOW()
      WHERE id::text = $1 AND status IN ('failed', 'queued') RETURNING id, status)
      SELECT id, status FROM retried`,
      [id],
    );
  }

  /**
   * 补投。每次最多领 20 条到期任务。
   * 领任务、等 RabbitMQ 确认、改成 queued，放在同一个事务里。确认失败就仍保持 pending，30 秒后再试。
   * SKIP LOCKED 让多个进程不会领到同一行。
   */
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (let count = 0; count < 20; count += 1) {
        const sent = await this.dataSource.transaction(async (manager) => {
          const [job] = await manager.query(`SELECT * FROM kh_pipeline_job
            WHERE status IN ('pending', 'queued') AND next_attempt_at <= NOW()
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
          if (!job) return false;
          try {
            if (job.kind === 'published')
              await this.mqService.publish(job.payload);
            else if (job.kind === 'keyword')
              await this.mqService.publishKeyword(job.payload);
            else await this.mqService.publishGraph(job.payload);
            await manager.query(
              `UPDATE kh_pipeline_job SET status = 'queued',
              next_attempt_at = NOW() + INTERVAL '15 minutes', updated_at = NOW() WHERE id = $1`,
              [job.id],
            );
          } catch (error) {
            await manager.query(
              `UPDATE kh_pipeline_job SET status = 'pending', last_error = $2,
              next_attempt_at = NOW() + INTERVAL '30 seconds', updated_at = NOW() WHERE id = $1`,
              [job.id, error instanceof Error ? error.message : String(error)],
            );
          }
          return true;
        });
        if (!sent) break;
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * 判断这条消息还该不该写索引。
   * 任务已完成、过时或失败，直接跳过。
   * 索引任务必须对得上当前已发布文档的 contentId 和发布时间；删除任务则要求文档已经不再是已发布。
   * 对不上就把任务标成 obsolete，避免旧版本覆盖新版本。
   */
  private async currentJob(
    manager: EntityManager,
    message: DocumentPublishedMessage,
  ) {
    if (message.jobId) {
      const [job] = await manager.query(
        `SELECT status FROM kh_pipeline_job WHERE id = $1`,
        [message.jobId],
      );
      if (!job || ['completed', 'obsolete', 'failed'].includes(job.status))
        return false;
    }
    const document = await manager.findOne(Document, {
      where: { id: BigInt(message.documentId) },
    });
    const published =
      document &&
      !document.deleted &&
      document.status === DocumentStatus.PUBLISHED;
    const current =
      message.action === 'delete'
        ? !published
        : published &&
          document.contentId === message.contentId &&
          document.publishTime?.toISOString() === message.publishedAt;
    if (!current && message.jobId) {
      await manager.query(
        `UPDATE kh_pipeline_job SET status = $2, last_error = NULL,
        updated_at = NOW() WHERE id = $1`,
        [message.jobId, 'obsolete'],
      );
    }
    return Boolean(current);
  }

  /**
   * 队列消息的总入口。prepare 是某一条通道的准备工作，返回真正写索引的函数。
   * 贵的步骤放在文档锁外面；写之前再锁住文档并核对版本，避免旧任务覆盖新正文。
   */
  private async processJob(
    message: DocumentPublishedMessage,
    prepare: () => Promise<() => Promise<unknown>>,
  ) {
    // 没有合法文档 id 的消息无法对上任务表，直接抛给队列重试。
    if (!message || !/^\d+$/.test(message.documentId))
      throw new Error('Invalid pipeline message');
    try {
      // 第一次核对不锁文档。任务已结束，或正文版本已经变了，就不再做切片和调用模型。
      const eligible = await this.dataSource.transaction((manager) =>
        this.currentJob(manager, message),
      );
      if (!eligible) return;
      // 锁外准备。向量通道在这里切片并生成向量，图谱通道在这里抽取实体。
      const write = await prepare();
      await this.dataSource.transaction(async (manager) => {
        // 同一篇文档的写入串行。准备期间如果又发布了新版本，下面这次核对会失败。
        await lockDocument(manager, message.documentId);
        if (!(await this.currentJob(manager, message))) return;
        await write();
        // 索引写成功才算完成。这个更新和写入在同一事务里，写入抛错会一起回滚。
        if (message.jobId) {
          await manager.query(
            `UPDATE kh_pipeline_job SET status = $2, last_error = NULL,
            updated_at = NOW() WHERE id = $1`,
            [message.jobId, 'completed'],
          );
        }
      });
    } catch (error) {
      // 没有 jobId 的旧消息无法记到任务表，抛回队列走 .retry。
      if (!message.jobId) throw error;
      // 有 jobId 时吞掉异常，队列会 ack。失败次数加 1，原来已达 5 次就标 failed，否则回到 pending 等 flush 再发。
      await this.dataSource.query(
        `UPDATE kh_pipeline_job SET attempts = attempts + 1,
        status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
        next_attempt_at = NOW() + INTERVAL '30 seconds' * power(2, LEAST(attempts, 5)),
        last_error = $2, updated_at = NOW() WHERE id = $1 AND status NOT IN ('completed', 'obsolete')`,
        [message.jobId, error instanceof Error ? error.message : String(error)],
      );
      this.logger.error(`Pipeline job failed ${message.jobId}`);
    }
  }

  /**
   * 切片向量通道。锁外完成切分和向量化，返回一个稍后才执行的写入函数。
   * 缺字段或切分结果为空会抛错，由 processJob 记入任务表。
   */
  private async handlePublished(message: DocumentPublishedMessage) {
    if (!message?.documentId || !message.contentId || !message.title?.trim()) {
      throw new Error('发布消息缺少 documentId、contentId 或 title');
    }

    const content = await this.loadContent(message.contentId);
    const chunks = await splitToChunks(
      message.title,
      content,
      `${message.documentId}:${message.contentId}`,
    );
    if (chunks.length === 0) {
      throw new Error('文档切分结果为空');
    }

    const embeddedChunks = await embedChunks(chunks);
    return async () => {
      await indexEmbeddedChunks({
        documentId: message.documentId,
        contentId: message.contentId,
        chunks: embeddedChunks,
      });
      this.logger.log(
        `文档已写入向量索引 documentId=${message.documentId} chunks=${embeddedChunks.length}`,
      );
    };
  }

  /** 全文通道。不切片，锁外只读出整篇正文，写入留到版本核对之后。 */
  private async handleKeyword(message: DocumentPublishedMessage) {
    if (!message?.documentId || !message.contentId || !message.title?.trim()) {
      throw new Error('发布消息缺少 documentId、contentId 或 title');
    }

    const content = await this.loadContent(message.contentId);
    return async () => {
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
    };
  }

  /** 图谱通道。锁外抽取实体和关系，核对版本后再写入 Neo4j。 */
  private async handleGraph(message: DocumentPublishedMessage) {
    if (!message?.documentId || !message.contentId || !message.title?.trim()) {
      throw new Error('发布消息缺少 documentId、contentId 或 title');
    }

    const content = await this.loadContent(message.contentId);
    const write = await prepareDocumentGraph({
      documentId: message.documentId,
      contentId: message.contentId,
      title: message.title,
      publishedAt: message.publishedAt,
      content,
    });
    return async () => {
      if (!write) return;
      const result = await write();
      this.logger.log(
        `文档已写入图谱 documentId=${message.documentId} chunks=${result.chunks} entities=${result.entities} relations=${result.relations}`,
      );
    };
  }

  /** 按 contentId 从 MongoDB 读取整篇 Markdown。三个通道写索引前都从这里取正文。 */
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
