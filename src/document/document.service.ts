import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import path from 'node:path';
import { Repository } from 'typeorm';
import { detectParser, parseToMarkdown } from '../parser/index.js';
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
import { snowflake } from './snowflake.js';

@Injectable()
export class DocumentService {
  constructor(
    @InjectModel(DocumentContent.name)
    private readonly documentContentModel: Model<DocumentContentDocument>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly rustfsService: RustfsService,
    private readonly pipelineManagerService: PipelineManagerService,
  ) {}

  async create(createDocumentDto: CreateDocumentDto) {
    return this.storeDocument({
      markdown: createDocumentDto.content ?? '',
      title: createDocumentDto.title,
      summary: createDocumentDto.summary ?? '',
      categoryId: createDocumentDto.categoryId,
      teamId: createDocumentDto.teamId,
      authorId: createDocumentDto.authorId,
      coverImage: createDocumentDto.coverImage,
      tags: createDocumentDto.tags,
      status: createDocumentDto.status,
      remark: createDocumentDto.remark,
      publishTime: createDocumentDto.publishTime,
      isPublic: createDocumentDto.isPublic,
      createBy: createDocumentDto.createBy,
    });
  }

  async publish(documentId: string) {
    if (!/^\d+$/.test(documentId)) {
      throw new BadRequestException('文档 ID 无效');
    }

    const document = await this.documentRepository.findOne({
      where: { id: BigInt(documentId), deleted: false },
    });
    if (!document) {
      return { message: '文档不存在' };
    }
    if (document.status === DocumentStatus.PUBLISHED) {
      return { message: '文档已发布' };
    }

    const publishedAt = new Date();
    await this.pipelineManagerService.publishDocument({
      documentId: document.id.toString(),
      contentId: document.contentId,
      title: document.title,
      publishedAt: publishedAt.toISOString(),
    });
    document.status = DocumentStatus.PUBLISHED;
    document.publishTime = publishedAt;
    const saved = await this.documentRepository.save(document);

    return {
      message: '发布成功',
      document: this.serializeDocument(saved),
    };
  }

  async parseUpload(file: SourceFile, parseUploadDto: ParseUploadDto) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('文件不能为空');
    }

    const parser = detectParser(file.originalname || '');
    if (!parser) {
      throw new BadRequestException(
        '仅支持 doc、docx、xml、ppt、pptx、txt、xls、xlsx',
      );
    }

    const markdown = parseToMarkdown(parser, file.buffer).trim();
    if (!markdown) {
      throw new BadRequestException('文件内容为空');
    }

    return this.storeDocument({
      markdown,
      title:
        parseUploadDto.title?.trim() ||
        this.extractTitle(markdown, file.originalname),
      summary: parseUploadDto.summary?.trim() || this.extractSummary(markdown),
      categoryId: parseUploadDto.categoryId,
      teamId: parseUploadDto.teamId,
      authorId: parseUploadDto.authorId,
      coverImage: parseUploadDto.coverImage,
      tags: parseUploadDto.tags,
      status: parseUploadDto.status,
      remark: parseUploadDto.remark ?? file.originalname,
      isPublic: parseUploadDto.isPublic,
      createBy: parseUploadDto.createBy,
      sourceFile: file,
    });
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
    const contentId = snowflake.generate();

    await this.documentContentModel.create({
      contentId,
      content: input.markdown,
      length: input.markdown.length,
      contentSummary: input.summary,
      deleted: false,
    });

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
      await this.documentContentModel.deleteOne({ contentId });
      throw error;
    }
  }

  private extractTitle(markdown: string, filename: string) {
    const heading = markdown
      .split('\n')
      .map((line) => /^#{1,6}\s+(.+)$/.exec(line.trim())?.[1])
      .find(Boolean);
    if (heading) {
      return heading.trim();
    }
    return path.basename(filename, path.extname(filename)) || '未命名文档';
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
      categoryId: document.categoryId?.toString() ?? null,
      teamId: document.teamId?.toString() ?? null,
      authorId: document.authorId?.toString() ?? null,
      createBy: document.createBy?.toString() ?? null,
      updateBy: document.updateBy?.toString() ?? null,
    };
  }

  async findAll() {
    const documents = await this.documentRepository.find({
      where: { deleted: false },
      order: { createdAt: 'DESC' },
    });
    if (documents.length === 0) {
      return [];
    }

    const contents = await this.documentContentModel
      .find({
        contentId: { $in: documents.map((item) => item.contentId) },
        deleted: false,
      })
      .lean();
    const contentMap = new Map(contents.map((item) => [item.contentId, item]));

    return documents.map((document) => ({
      document: this.serializeDocument(document),
      content: this.serializeContent(
        contentMap.get(document.contentId) ?? null,
      ),
    }));
  }

  async findOne(id: string) {
    const document = await this.findDocument(id);
    const content = await this.documentContentModel
      .findOne({ contentId: document.contentId, deleted: false })
      .lean();

    return {
      document: this.serializeDocument(document),
      content: this.serializeContent(content),
    };
  }

  async update(id: string, updateDocumentDto: UpdateDocumentDto) {
    const document = await this.findDocument(id);

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
    if (updateDocumentDto.authorId !== undefined) {
      document.authorId = this.toBigint(updateDocumentDto.authorId);
    }
    if (updateDocumentDto.coverImage !== undefined) {
      document.coverImage = updateDocumentDto.coverImage;
    }
    if (updateDocumentDto.tags !== undefined) {
      document.tags = updateDocumentDto.tags;
    }
    if (updateDocumentDto.status !== undefined) {
      document.status = updateDocumentDto.status;
    }
    if (updateDocumentDto.remark !== undefined) {
      document.remark = updateDocumentDto.remark;
    }
    if (updateDocumentDto.isPublic !== undefined) {
      document.isPublic = updateDocumentDto.isPublic;
    }
    if (updateDocumentDto.publishTime !== undefined) {
      document.publishTime = new Date(updateDocumentDto.publishTime);
    }
    if (updateDocumentDto.updateBy !== undefined) {
      document.updateBy = this.toBigint(updateDocumentDto.updateBy);
    }

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
    if (Object.keys(contentUpdate).length > 0) {
      await this.documentContentModel.updateOne(
        { contentId: document.contentId },
        { $set: contentUpdate },
      );
    }

    const saved = await this.documentRepository.save(document);
    const content = await this.documentContentModel
      .findOne({ contentId: document.contentId })
      .lean();

    return {
      document: this.serializeDocument(saved),
      content: this.serializeContent(content),
    };
  }

  async remove(deleteDocumentDto: DeleteDocumentDto) {
    const document = await this.findDocument(deleteDocumentDto.id, true);
    const contentId = document.contentId;

    await this.pipelineManagerService.removeDocument(document.id.toString());
    await this.documentContentModel.deleteOne({ contentId });
    await this.documentRepository.delete({ id: document.id });

    return {
      id: document.id.toString(),
      contentId,
    };
  }

  private async findDocument(id: string, includeDeleted = false) {
    if (!/^\d+$/.test(id)) {
      throw new BadRequestException('文档 ID 无效');
    }

    const document = await this.documentRepository.findOne({
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

  private serializeContent(
    content: {
      contentId: string;
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
      contentId: content.contentId,
      content: content.content,
      length: content.length,
      contentSummary: content.contentSummary ?? '',
      deleted: content.deleted,
    };
  }
}
