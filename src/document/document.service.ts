import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { CreateDocumentDto } from './dto/create-document.dto.js';
import { DeleteDocumentDto } from './dto/delete-document.dto.js';
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
  ) {}

  async create(createDocumentDto: CreateDocumentDto) {
    const content = createDocumentDto.content ?? '';
    const contentId = snowflake.generate();

    await this.documentContentModel.create({
      contentId,
      content,
      length: content.length,
      deleted: false,
    });

    try {
      const document = await this.documentRepository.save(
        this.documentRepository.create({
          title: createDocumentDto.title,
          contentId,
          summary: createDocumentDto.summary ?? null,
          categoryId: this.toBigint(createDocumentDto.categoryId),
          teamId: this.toBigint(createDocumentDto.teamId),
          authorId: this.toBigint(createDocumentDto.authorId),
          coverImage: createDocumentDto.coverImage ?? null,
          tags: createDocumentDto.tags ?? null,
          status: createDocumentDto.status ?? 0,
          remark: createDocumentDto.remark ?? null,
          wordCount: content.length,
          publishTime: createDocumentDto.publishTime
            ? new Date(createDocumentDto.publishTime)
            : null,
          isPublic: createDocumentDto.isPublic ?? false,
          createBy: this.toBigint(createDocumentDto.createBy),
          deleted: false,
        }),
      );

      return {
        document: this.serializeDocument(document),
        content: {
          contentId,
          content,
          length: content.length,
          deleted: false,
        },
      };
    } catch (error) {
      await this.documentContentModel.deleteOne({ contentId });
      throw error;
    }
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
