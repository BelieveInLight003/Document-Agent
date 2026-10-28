import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatOpenAI } from '@langchain/openai';
import { In, Repository } from 'typeorm';
import { decodeUploadedText } from '../document/decode-uploaded-text.js';
import { Document } from '../document/entities/document.entity.js';
import { AskDto } from './dto/ask.dto.js';
import { retrieveChunks } from './hybrid-retriever.js';
import { chatMessages, UNANSWERABLE } from './prompt.js';
import type { ChatResultView, HybridResultView } from './ai.view.js';

const DEFAULT_LIMIT = 5;

@Injectable()
export class AiService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
  ) {}

  /** 关键词加向量融合。不调用对话模型。 */
  async retrieve(dto: AskDto): Promise<HybridResultView> {
    const question = requiredQuestion(dto.question);
    const items = await this.retrieveItems(
      question,
      dto.limit ?? DEFAULT_LIMIT,
    );
    return { question, items };
  }

  /** 先混合检索，再把命中的原文交给对话模型。没有资料时不调用模型。 */
  async chat(dto: AskDto): Promise<ChatResultView> {
    const question = requiredQuestion(dto.question);
    const items = await this.retrieveItems(
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

  private async retrieveItems(question: string, limit: number) {
    let items;
    try {
      items = await retrieveChunks(question, limit);
    } catch {
      throw new ServiceUnavailableException('混合检索不可用');
    }
    return this.overlayDocuments(items);
  }

  /** 用 Postgres 里的标题和正文 id 覆盖切片上的副本。 */
  private async overlayDocuments(
    items: Awaited<ReturnType<typeof retrieveChunks>>,
  ) {
    const ids = [
      ...new Set(
        items.map((item) => item.documentId).filter((id) => /^\d+$/.test(id)),
      ),
    ];
    if (ids.length === 0) {
      return items;
    }
    const rows = await this.documentRepository.find({
      where: { id: In(ids.map((id) => BigInt(id))), deleted: false },
    });
    const byId = new Map(rows.map((row) => [row.id.toString(), row]));
    return items.map((item) => {
      const row = byId.get(item.documentId);
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
