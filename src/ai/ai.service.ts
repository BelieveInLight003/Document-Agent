import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatOpenAI } from '@langchain/openai';
import { In, Repository } from 'typeorm';
import {
  filterReadableChunks,
  toDocumentAccess,
  type DocumentAccessTarget,
  type DocumentViewer,
} from '../document/document-access.js';
import { decodeUploadedText } from '../document/decode-uploaded-text.js';
import { Document } from '../document/entities/document.entity.js';
import { AskDto } from './dto/ask.dto.js';
import { retrieveChunks } from './hybrid-retriever.js';
import { chatMessages, UNANSWERABLE } from './prompt.js';
import type { ChatResultView, HybridResultView } from './ai.view.js';

const DEFAULT_LIMIT = 5;
/**
 * 混合检索先多取一些候选，再用文档权限滤掉不能看的切片，最后才截到调用方要的条数。
 * 否则排在前面的私有文档会把名额占满，用户能看的资料反而出不来。
 */
const ACCESS_WINDOW = 20;

@Injectable()
export class AiService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
  ) {}

  /** 关键词加向量融合。不调用对话模型。结果只保留当前用户能读的已发布文档。 */
  async retrieve(viewer: DocumentViewer, dto: AskDto): Promise<HybridResultView> {
    const question = requiredQuestion(dto.question);
    const items = await this.retrieveItems(
      viewer,
      question,
      dto.limit ?? DEFAULT_LIMIT,
    );
    return { question, items };
  }

  /** 先混合检索，再把命中的原文交给对话模型。没有资料时不调用模型。 */
  async chat(viewer: DocumentViewer, dto: AskDto): Promise<ChatResultView> {
    const question = requiredQuestion(dto.question);
    const items = await this.retrieveItems(
      viewer,
      question,
      dto.limit ?? DEFAULT_LIMIT,
    );
    if (items.length === 0) {
      return { question, answer: UNANSWERABLE, items };
    }

    try {
      const response = await createChat().invoke(chatMessages(question, items));
      const answer = messageText(response.content).trim() || UNANSWERABLE;
      return { question, answer, items };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException('对话不可用');
    }
  }

  private async retrieveItems(viewer: DocumentViewer, question: string, limit: number) {
    let items;
    try {
      items = await retrieveChunks(question, ACCESS_WINDOW);
    } catch {
      throw new ServiceUnavailableException('混合检索不可用');
    }
    return this.readableItems(viewer, items, limit);
  }

  /**
   * 用 Postgres 里的文档核对阅读权限，并覆盖切片上的标题。
   * 未发布、非公开且既不是作者也不是管理员或审核员的文档会被丢掉。
   */
  private async readableItems(
    viewer: DocumentViewer,
    items: Awaited<ReturnType<typeof retrieveChunks>>,
    limit: number,
  ) {
    const documents = await this.loadDocuments(items);
    return filterReadableChunks(items, viewer, documents)
      .slice(0, limit)
      .map((item) => {
        const row = documents.get(item.documentId);
        if (!row) {
          return item;
        }
        return {
          ...item,
          title: decodeUploadedText(row.title),
          contentId: row.contentId,
        };
      });
  }

  /** 按切片上的文档 id 取未删除文档。id 不是数字的切片没有对应行，后面会被权限过滤掉。 */
  private async loadDocuments(items: Array<{ documentId: string }>) {
    const ids = [
      ...new Set(items.map((item) => item.documentId).filter((id) => /^\d+$/.test(id))),
    ];
    if (ids.length === 0) {
      return new Map<string, DocumentAccessTarget & { title: string; contentId: string }>();
    }
    const rows = await this.documentRepository.find({
      where: { id: In(ids.map((id) => BigInt(id))), deleted: false },
    });
    return new Map(
      rows.map((row) => [
        row.id.toString(),
        { ...toDocumentAccess(row), title: row.title, contentId: row.contentId },
      ]),
    );
  }
}

function requiredQuestion(question: string) {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new BadRequestException('问题不能为空');
  }
  return trimmed;
}

function createChat() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ServiceUnavailableException('对话模型未配置');
  }
  return new ChatOpenAI({
    apiKey,
    model: process.env.CHAT_MODEL ?? 'qwen-plus',
    temperature: 0,
    configuration: {
      baseURL:
        process.env.OPENAI_BASE_URL ??
        process.env.EMBEDDING_BASE_URL ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
  });
}

function messageText(content: unknown) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part && typeof part === 'object' && 'text' in part) {
        return String(part.text ?? '');
      }
      return '';
    })
    .join('');
}
