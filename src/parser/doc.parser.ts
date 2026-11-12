import { parseWithMineru } from './mineru.js';

/** 把 Word 交给 MinerU。zip 包是 docx，其余按旧版 doc。 */
export function parseDoc(buffer: Buffer) {
  const extension = buffer.subarray(0, 2).toString('utf8') === 'PK' ? 'docx' : 'doc';
  return parseWithMineru(buffer, extension);
}
