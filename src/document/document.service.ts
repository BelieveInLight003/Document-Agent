import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model, Types } from 'mongoose';
import path from 'node:path';
import { DataSource, Repository } from 'typeorm';
import {
  canEditDocument,
  canViewDocument,
  toDocumentAccess,
  type DocumentViewer,
} from './document-access.js';
import { lockDocument } from './document-lock.js';
import { decodeUploadedText } from './decode-uploaded-text.js';
import {
  detectParser,
  parseToMarkdown,
  replaceImageRefs,
  type ParsedImage,
} from '../parser/index.js';
import { PipelineManagerService } from '../pipelineManager/pipeline-manager.service.js';
import { RustfsService, type SourceFile } from '../storage/rustfs.service.js';
import { DocumentStatus } from './document-status.js';
import { CreateDocumentDto } from './dto/create-document.dto.js';
import { DeleteDocumentDto } from './dto/delete-document.dto.js';
import { ParseUploadDto } from './dto/parse-upload.dto.js';
import { UpdateDocumentDto } from './dto/update-document.dto.js';
import { Document } from './entities/document.entity.js';
import {
  DocumentContent,
  type DocumentContentDocument,
} from './schema/document.content.schema.js';

@Injectable()
export class DocumentService implements OnModuleInit {
  constructor(
    @InjectModel(DocumentContent.name)
    private readonly documentContentModel: Model<DocumentContentDocument>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly rustfsService: RustfsService,
    private readonly pipelineManagerService: PipelineManagerService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 旧正文用雪花 contentId 关联。启动时把 Postgres content_id 改成对应 Mongo _id，
   * 再去掉这个字段和唯一索引。
   */
  async onModuleInit() {
    let legacy: Array<{ _id: Types.ObjectId; contentId?: string }>;
    try {
      // 原生集合返回的是 Mongo 文档。同文件里的 Document 实体会挡住驱动的 Document 类型。
      legacy = (await this.documentContentModel.collection
        .find({ contentId: { $type: 'string' } })
        .project({ contentId: 1 })
        .toArray()) as unknown as Array<{
        _id: Types.ObjectId;
        contentId?: string;
      }>;
    } catch (error) {
      if ((error as { code?: number }).code === 26) {
        return;
      }
      throw error;
    }

    for (const item of legacy) {
      const previousId = item.contentId;
      if (!previousId) {
        continue;
      }
      const mongoId = item._id.toString();
      const updated = await this.documentRepository.update(
        { contentId: previousId },
        { contentId: mongoId },
      );
      const linked =
        (updated.affected ?? 0) > 0 ||
        (await this.documentRepository.findOne({
          where: { contentId: mongoId },
        }));
      if (linked) {
        await this.documentContentModel.collection.updateOne(
          { _id: item._id },
          { $unset: { contentId: '' } },
        );
      }
    }

    const indexes = await this.documentContentModel.collection.indexes();
    if (indexes.some((index) => index.name === 'contentId_1')) {
      await this.documentContentModel.collection.dropIndex('contentId_1');
    }
  }

  async create(createDocumentDto: CreateDocumentDto, viewer: DocumentViewer) {
    this.requireDraft(createDocumentDto.status);
    return this.storeDocument({
      markdown: createDocumentDto.content ?? '',
      title: createDocumentDto.title,
      summary: createDocumentDto.summary ?? '',
      categoryId: createDocumentDto.categoryId,
      teamId: createDocumentDto.teamId,
      authorId: viewer.userId,
      coverImage: createDocumentDto.coverImage,
      tags: createDocumentDto.tags,
      status: DocumentStatus.DRAFT,
      remark: createDocumentDto.remark,
      isPublic: createDocumentDto.isPublic,
      createBy: viewer.userId,
    });
  }

  async publish(documentId: string, viewer: DocumentViewer) {
    return this.dataSource.transaction(async (manager) => {
      await lockDocument(manager, documentId);
      if (!/^\d+$/.test(documentId)) {
        throw new BadRequestException('文档 ID 无效');
      }

      const document = await manager.findOne(Document, {
        where: { id: BigInt(documentId), deleted: false },
      });
      if (!document) {
        throw new NotFoundException('文档不存在');
      }
      this.requireEdit(viewer, document);
      if (document.status === DocumentStatus.PENDING_REVIEW) {
        return { message: '文档正在审核，不能直接发布' };
      }
      if (document.status === DocumentStatus.PUBLISHED) {
        return { message: '文档已发布' };
      }

      const publishedAt = new Date();
      document.title = decodeUploadedText(document.title);
      // Reviewers can approve through the review workflow; owners cannot bypass it.
      if (!viewer.roles.includes('ROLE_ADMIN')) {
        throw new ForbiddenException('请提交审核后发布');
      }
      document.status = DocumentStatus.PUBLISHED;
      document.publishTime = publishedAt;
      const saved = await manager.save(document);
      await this.pipelineManagerService.publishDocument(
        {
          documentId: document.id.toString(),
          contentId: document.contentId,
          title: document.title,
          publishedAt: publishedAt.toISOString(),
        },
        manager,
      );

      return {
        message: '发布成功',
        document: this.serializeDocument(saved),
      };
    });
  }

  async parseUpload(
    file: SourceFile,
    parseUploadDto: ParseUploadDto,
    viewer: DocumentViewer,
  ) {
    this.requireDraft(parseUploadDto.status);
    if (!file?.buffer?.length) {
      throw new BadRequestException('文件不能为空');
    }

    const originalname = decodeUploadedText(file.originalname || '');
    const namedFile = { ...file, originalname };
    const parser = detectParser(originalname);
    if (!parser) {
      throw new BadRequestException(
        '仅支持 doc、docx、xml、ppt、pptx、txt、xls、xlsx、pdf',
      );
    }

    const parsed = await parseToMarkdown(parser, file.buffer);
    const markdown = (
      await this.mountImages(parsed.markdown, parsed.images)
    ).trim();
    if (!markdown) {
      throw new BadRequestException('文件内容为空');
    }

    return this.storeDocument({
      markdown,
      title:
        parseUploadDto.title?.trim() ||
        this.extractTitle(markdown, originalname),
      summary: parseUploadDto.summary?.trim() || this.extractSummary(markdown),
      categoryId: parseUploadDto.categoryId,
      teamId: parseUploadDto.teamId,
      authorId: viewer.userId,
      coverImage: parseUploadDto.coverImage,
      tags: parseUploadDto.tags,
      status: DocumentStatus.DRAFT,
      remark: parseUploadDto.remark ?? originalname,
      isPublic: parseUploadDto.isPublic,
      createBy: viewer.userId,
      sourceFile: namedFile,
    });
  }

  /** 文档图片上传到 RustFS，Markdown 里的相对路径换成可访问链接。 */
  private async mountImages(markdown: string, images: ParsedImage[]) {
    const urls = new Map<string, string>();
    for (const image of images) {
      if (urls.has(image.ref)) {
        continue;
      }
      const uploaded = await this.rustfsService.uploadDocumentImage({
        filename: image.filename,
        buffer: image.data,
        contentType: image.contentType,
      });
      urls.set(image.ref, uploaded.url);
    }
    return replaceImageRefs(markdown, urls);
  }

  /** 拿到 Markdown 后，只在这里写入 RustFS、MongoDB 和 PostgreSQL。 */
  private async storeDocument(input: {
    markdown: string;
    title: string;
    summary: string;
    categoryId?: string;
    teamId?: string;
    authorId?: string;
    coverImage?: string;
    tags?: string;
    status?: number;
    remark?: string;
    publishTime?: string;
    isPublic?: boolean;
    createBy?: string;
    sourceFile?: SourceFile;
  }) {
    const source = input.sourceFile
      ? await this.rustfsService.uploadSourceFile(input.sourceFile)
      : undefined;
    const created = await this.documentContentModel.create({
      content: input.markdown,
      length: input.markdown.length,
      contentSummary: input.summary,
      deleted: false,
    });
    const contentId = created._id.toString();

    try {
      const document = await this.documentRepository.save(
        this.documentRepository.create({
          title: input.title,
          contentId,
          summary: input.summary || null,
          categoryId: this.toBigint(input.categoryId),
          teamId: this.toBigint(input.teamId),
          authorId: this.toBigint(input.authorId),
          coverImage: input.coverImage ?? null,
          tags: input.tags ?? null,
          status: input.status ?? 0,
          remark: input.remark ?? null,
          wordCount: input.markdown.length,
          publishTime: input.publishTime ? new Date(input.publishTime) : null,
          isPublic: input.isPublic ?? false,
          createBy: this.toBigint(input.createBy),
          deleted: false,
        }),
      );

      return {
        document: this.serializeDocument(document),
        content: {
          contentId,
          content: input.markdown,
          length: input.markdown.length,
          contentSummary: input.summary,
          deleted: false,
        },
        source,
      };
    } catch (error) {
      await this.documentContentModel.deleteOne({ _id: created._id });
      throw error;
    }
  }

  private extractTitle(markdown: string, filename: string) {
    const heading = markdown
      .split('\n')
      .map((line) => /^#{1,6}\s+(.+)$/.exec(line.trim())?.[1])
      .find(Boolean);
    if (heading) {
      return decodeUploadedText(heading.trim());
    }
    return (
      decodeUploadedText(path.basename(filename, path.extname(filename))) ||
      '未命名文档'
    );
  }

  private extractSummary(markdown: string) {
    const paragraph = markdown
      .split('\n')
      .map((line) => line.trim())
      .find(
        (line) =>
          line &&
          !line.startsWith('#') &&
          !line.startsWith('|') &&
          !line.startsWith('-'),
      );
    return (paragraph ?? '').replace(/[*_`]/g, '').slice(0, 200);
  }

  private toBigint(value?: string): bigint | null {
    return value ? BigInt(value) : null;
  }

  private serializeDocument(document: Document) {
    return {
      ...document,
      id: document.id.toString(),
      title: decodeUploadedText(document.title),
      remark: document.remark ? decodeUploadedText(document.remark) : null,
      categoryId: document.categoryId?.toString() ?? null,
      teamId: document.teamId?.toString() ?? null,
      authorId: document.authorId?.toString() ?? null,
      createBy: document.createBy?.toString() ?? null,
      updateBy: document.updateBy?.toString() ?? null,
    };
  }

  async findAll(viewer: DocumentViewer) {
    const documents = (
      await this.documentRepository.find({
        where: { deleted: false },
        order: { createdAt: 'DESC' },
      })
    ).filter((row) => canViewDocument(viewer, toDocumentAccess(row)));
    if (documents.length === 0) {
      return [];
    }

    const contentIds = documents
      .map((item) => item.contentId)
      .filter((contentId) => Types.ObjectId.isValid(contentId));
    const contents = await this.documentContentModel
      .find({
        _id: { $in: contentIds },
        deleted: false,
      })
      .lean();
    const contentMap = new Map(
      contents.map((item) => [item._id.toString(), item]),
    );

    return documents.map((document) => ({
      document: this.serializeDocument(document),
      content: this.serializeContent(
        contentMap.get(document.contentId) ?? null,
      ),
    }));
  }

  async findOne(id: string, viewer: DocumentViewer) {
    const document = await this.findDocument(id);
    if (!canViewDocument(viewer, toDocumentAccess(document))) {
      throw new NotFoundException('文档不存在');
    }
    const content = await this.findContent(document.contentId, false);

    return {
      document: this.serializeDocument(document),
      content: this.serializeContent(content),
    };
  }

  async update(
    id: string,
    updateDocumentDto: UpdateDocumentDto,
    viewer: DocumentViewer,
  ) {
    let newContentId: string | undefined;
    try {
      return await this.dataSource.transaction(async (manager) => {
        await lockDocument(manager, id);
        const document = await this.findDocument(id, false, manager);
        this.requireEdit(viewer, document);
        if (document.status === DocumentStatus.PENDING_REVIEW) {
          throw new BadRequestException('审核中的文档不能修改');
        }
        if (
          updateDocumentDto.status !== undefined &&
          updateDocumentDto.status !== document.status
        ) {
          throw new BadRequestException('请通过审核、发布或归档接口修改状态');
        }
        if (
          updateDocumentDto.authorId !== undefined &&
          updateDocumentDto.authorId !== document.authorId?.toString()
        ) {
          throw new BadRequestException('不能修改文档作者');
        }
        if (updateDocumentDto.publishTime !== undefined) {
          throw new BadRequestException('发布时间由服务端设置');
        }
        const changesEvidence =
          updateDocumentDto.content !== undefined ||
          updateDocumentDto.title !== undefined ||
          updateDocumentDto.summary !== undefined;
        if (document.status === DocumentStatus.PUBLISHED && changesEvidence) {
          document.status = DocumentStatus.DRAFT;
          await this.pipelineManagerService.removeDocument(id, manager);
        }

        if (updateDocumentDto.title !== undefined) {
          document.title = updateDocumentDto.title;
        }
        if (updateDocumentDto.summary !== undefined) {
          document.summary = updateDocumentDto.summary;
        }
        if (updateDocumentDto.categoryId !== undefined) {
          document.categoryId = this.toBigint(updateDocumentDto.categoryId);
        }
        if (updateDocumentDto.teamId !== undefined) {
          document.teamId = this.toBigint(updateDocumentDto.teamId);
        }
        if (updateDocumentDto.coverImage !== undefined) {
          document.coverImage = updateDocumentDto.coverImage;
        }
        if (updateDocumentDto.tags !== undefined) {
          document.tags = updateDocumentDto.tags;
        }
        if (updateDocumentDto.remark !== undefined) {
          document.remark = updateDocumentDto.remark;
        }
        if (updateDocumentDto.isPublic !== undefined) {
          document.isPublic = updateDocumentDto.isPublic;
        }
        document.updateBy = BigInt(viewer.userId);

        const contentUpdate: {
          content?: string;
          length?: number;
          contentSummary?: string;
        } = {};
        if (updateDocumentDto.content !== undefined) {
          contentUpdate.content = updateDocumentDto.content;
          contentUpdate.length = updateDocumentDto.content.length;
          document.wordCount = updateDocumentDto.content.length;
        }
        if (updateDocumentDto.summary !== undefined) {
          contentUpdate.contentSummary = updateDocumentDto.summary;
        }
        if (changesEvidence) {
          const previous = await this.findContent(document.contentId, false);
          const body = await this.documentContentModel.create({
            content: contentUpdate.content ?? previous?.content ?? '',
            length: contentUpdate.length ?? previous?.length ?? 0,
            contentSummary:
              contentUpdate.contentSummary ?? previous?.contentSummary ?? '',
            deleted: false,
          });
          document.contentId = body._id.toString();
          newContentId = document.contentId;
        }

        const saved = await manager.save(document);
        const content = await this.findContent(document.contentId);

        return {
          document: this.serializeDocument(saved),
          content: this.serializeContent(content),
        };
      });
    } catch (error) {
      if (newContentId) {
        await this.documentContentModel
          .deleteOne({ _id: newContentId })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async remove(deleteDocumentDto: DeleteDocumentDto, viewer: DocumentViewer) {
    return this.dataSource.transaction(async (manager) => {
      await lockDocument(manager, deleteDocumentDto.id);
      const document = await this.findDocument(
        deleteDocumentDto.id,
        true,
        manager,
      );
      this.requireEdit(viewer, document);
      const contentId = document.contentId;

      await this.pipelineManagerService.removeDocument(
        document.id.toString(),
        manager,
      );
      // Keep the body until asynchronous index cleanup has finished.
      document.deleted = true;
      await manager.save(document);

      return {
        id: document.id.toString(),
        contentId,
      };
    });
  }

  private requireDraft(status?: number) {
    if (status !== undefined && status !== DocumentStatus.DRAFT) {
      throw new BadRequestException('新文档必须从草稿开始');
    }
  }

  private requireEdit(viewer: DocumentViewer, document: Document) {
    if (!canEditDocument(viewer, toDocumentAccess(document))) {
      throw new ForbiddenException('不能修改其他用户的文档');
    }
  }

  private async findDocument(
    id: string,
    includeDeleted = false,
    manager = this.documentRepository.manager,
  ) {
    if (!/^\d+$/.test(id)) {
      throw new BadRequestException('文档 ID 无效');
    }

    const document = await manager.findOne(Document, {
      where: {
        id: BigInt(id),
        ...(includeDeleted ? {} : { deleted: false }),
      },
    });
    if (!document) {
      throw new NotFoundException('文档不存在');
    }
    return document;
  }

  private findContent(contentId: string, deleted?: boolean) {
    if (!Types.ObjectId.isValid(contentId)) {
      return null;
    }
    return this.documentContentModel
      .findOne({
        _id: contentId,
        ...(deleted === undefined ? {} : { deleted }),
      })
      .lean();
  }

  private serializeContent(
    content: {
      _id: { toString(): string };
      content: string;
      length: number;
      contentSummary?: string;
      deleted: boolean;
    } | null,
  ) {
    if (!content) {
      return null;
    }
    return {
      contentId: content._id.toString(),
      content: content.content,
      length: content.length,
      contentSummary: content.contentSummary ?? '',
      deleted: content.deleted,
    };
  }
}
