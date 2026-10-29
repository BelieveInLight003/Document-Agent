import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Client } from '@elastic/elasticsearch';
import { In, Repository } from 'typeorm';
import { canReadDocument, toDocumentAccess, type DocumentViewer } from '../document/document-access.js';
import { Document } from '../document/entities/document.entity.js';
import { getEsDocumentTarget } from '../pipelineManager/es-document.js';
import { SearchQueryDto } from './dto/search-query.dto.js';
import { searchDocumentView, type SearchHitView, type SearchResultView } from './search.view.js';

/** 权限过滤会丢掉一部分命中，每批多取一些再筛，避免一页里全是看不到的文档。 */
const ACCESS_BATCH = 40;
/** Elasticsearch 允许的最大偏移。 */
const MAX_WINDOW = 10000;
/** 高亮文段条数，先固定 3 段。 */
const HIGHLIGHT_SECTIONS = 3;
/** 每一段大约截取的字数。 */
const FRAGMENT_SIZE = 120;
/** IK 粗粒度分词。索引仍用 ik_max_word，查询侧用它做较粗的召回。 */
const COARSE_ANALYZER = 'ik_smart';

type IndexedDocument = {
  documentId: string;
  contentId: string;
  title: string;
  content: string;
  publishedAt: string;
};

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
  ) {}

  /** 关键词检索后只保留当前用户能读的已发布文档。 */
  async search(viewer: DocumentViewer, query: SearchQueryDto): Promise<SearchResultView> {
    const keyword = query.keyword.trim();
    if (!keyword) {
      throw new BadRequestException('关键词不能为空');
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const from = (page - 1) * pageSize;
    if (from + pageSize > MAX_WINDOW) {
      throw new BadRequestException('分页超出检索范围');
    }

    const target = getEsDocumentTarget();
    if (!target) {
      throw new ServiceUnavailableException('全文检索未启用');
    }

    const readable = await this.collectReadable(viewer, target.client, target.index, {
      keyword,
      needed: from + pageSize,
    });
    return {
      total: readable.total,
      page,
      pageSize,
      list: readable.hits.slice(from, from + pageSize),
    };
  }

  /**
   * 按批读取索引，筛掉不能读的文档，直到凑够当前页，或索引读完。
   * 索引读完时 total 是实际能看的条数；还没读完时只保证当前页之后至少还有一页可翻。
   */
  private async collectReadable(
    viewer: DocumentViewer,
    client: Client,
    index: string,
    input: { keyword: string; needed: number },
  ) {
    const hits: SearchHitView[] = [];
    let esFrom = 0;
    let exhausted = false;
    while (hits.length < input.needed && esFrom < MAX_WINDOW) {
      const size = Math.min(ACCESS_BATCH, MAX_WINDOW - esFrom);
      const result = await this.queryIndex(client, index, {
        keyword: input.keyword,
        from: esFrom,
        pageSize: size,
      });
      if (!result) {
        exhausted = true;
        break;
      }
      const batch = result.hits.hits;
      if (batch.length === 0) {
        exhausted = true;
        break;
      }
      hits.push(...(await this.readableHits(viewer, batch)));
      esFrom += batch.length;
      if (batch.length < size || esFrom >= readTotal(result.hits.total)) {
        exhausted = true;
        break;
      }
    }
    return {
      hits,
      total: exhausted ? hits.length : Math.max(hits.length, input.needed + 1),
    };
  }

  /** 一批索引命中里，留下已发布且当前用户有阅读权限的文档。 */
  private async readableHits(
    viewer: DocumentViewer,
    hits: Array<{
      _score?: number | null;
      _source?: IndexedDocument;
      highlight?: { content?: string[] };
    }>,
  ) {
    const contentIds = hits
      .map((hit) => hit._source?.contentId)
      .filter((contentId): contentId is string => Boolean(contentId));
    const documents =
      contentIds.length === 0
        ? []
        : await this.documentRepository.find({
            where: { contentId: In(contentIds), deleted: false },
          });
    const documentMap = new Map(documents.map((document) => [document.contentId, document]));
    return hits.flatMap((hit) => {
      const contentId = hit._source?.contentId;
      const document = contentId ? documentMap.get(contentId) : undefined;
      if (!document || !canReadDocument(viewer, toDocumentAccess(document))) {
        return [];
      }
      return [
        {
          score: hit._score ?? null,
          highlights: (hit.highlight?.content ?? []).slice(0, HIGHLIGHT_SECTIONS),
          document: searchDocumentView(document),
        },
      ];
    });
  }

  /** 索引不存在时返回 null。连不上 Elasticsearch 时转为 503。 */
  private async queryIndex(
    client: Client,
    index: string,
    input: { keyword: string; from: number; pageSize: number },
  ) {
    try {
      const indexExists = await client.indices.exists({ index });
      if (!indexExists) {
        return null;
      }

      return await client.search<IndexedDocument>({
        index,
        from: input.from,
        size: input.pageSize,
        query: {
          multi_match: {
            query: input.keyword,
            fields: ['title^2', 'content'],
            type: 'best_fields',
            analyzer: COARSE_ANALYZER,
            fuzziness: 'AUTO',
            prefix_length: 1,
            operator: 'or',
          },
        },
        highlight: {
          pre_tags: ['<em>'],
          post_tags: ['</em>'],
          fields: {
            content: {
              fragment_size: FRAGMENT_SIZE,
              number_of_fragments: HIGHLIGHT_SECTIONS,
              order: 'score',
            },
          },
        },
      });
    } catch (error) {
      this.logger.error(
        '全文检索失败',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('全文检索不可用');
    }
  }
}

function readTotal(total: number | { value: number } | undefined) {
  if (typeof total === 'number') {
    return total;
  }
  return total?.value ?? 0;
}
