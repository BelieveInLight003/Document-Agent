import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { snowflake } from '../document/snowflake.js';

export type DocumentChunk = {
  id: string;
  title: string;
  content: string;
};

/** 用 RecursiveCharacterTextSplitter 的 Markdown 分隔符切分，再补上编号和标题。 */
export async function splitToChunks(
  title: string,
  content: string,
): Promise<DocumentChunk[]> {
  const splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
    chunkSize: chunkSize(),
    chunkOverlap: chunkOverlap(),
  });
  const pieces = (await splitter.splitText(content))
    .map((piece) => piece.trim())
    .filter(Boolean);
  return pieces.map((piece) => ({
    id: snowflake.generate(),
    title,
    content: piece,
  }));
}

function chunkSize() {
  const size = Number(process.env.RAG_CHUNK_SIZE ?? 512);
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('RAG_CHUNK_SIZE 无效');
  }
  return size;
}

function chunkOverlap() {
  const overlap = Number(process.env.RAG_CHUNK_OVERLAP ?? 64);
  const size = chunkSize();
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= size) {
    throw new Error('RAG_CHUNK_OVERLAP 无效');
  }
  return overlap;
}
