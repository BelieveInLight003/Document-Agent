import { OpenAIEmbeddings } from '@langchain/openai';
import type { DocumentChunk } from './chunk.js';

export type EmbeddedChunk = DocumentChunk & {
  embedding: number[];
};

/** 按当前 .env 的 Embedding 配置初始化。调用时再读取，避免模块加载时环境变量还没注入。 */
export function createEmbeddings() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 OPENAI_API_KEY');
  }

  return new OpenAIEmbeddings({
    apiKey,
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-v3',
    dimensions: embeddingDimensions(),
    batchSize: embeddingBatchSize(),
    configuration: {
      baseURL:
        process.env.EMBEDDING_BASE_URL ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
  });
}

/** 给 chunks 补上向量并返回，不负责存储。 */
export async function embedChunks(
  chunks: DocumentChunk[],
): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) {
    return [];
  }

  const dimensions = embeddingDimensions();
  const vectors = await createEmbeddings().embedDocuments(
    chunks.map((chunk) => chunk.content),
  );
  if (vectors.length !== chunks.length) {
    throw new Error('向量数量与 chunks 不一致');
  }

  return chunks.map((chunk, index) => {
    const embedding = vectors[index];
    if (!embedding || embedding.length !== dimensions) {
      throw new Error(
        `向量维度是 ${embedding?.length ?? 0}，配置的 EMBEDDING_DIMENSION 是 ${dimensions}`,
      );
    }
    return {
      ...chunk,
      embedding,
    };
  });
}

function embeddingDimensions() {
  const dimensions = Number(process.env.EMBEDDING_DIMENSION ?? 1024);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('EMBEDDING_DIMENSION 无效');
  }
  return dimensions;
}

function embeddingBatchSize() {
  const batchSize = Number(process.env.EMBEDDING_BATCH_SIZE ?? 10);
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('EMBEDDING_BATCH_SIZE 无效');
  }
  return batchSize;
}
