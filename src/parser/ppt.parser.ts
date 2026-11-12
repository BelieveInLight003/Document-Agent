import { parseWithMineru } from './mineru.js';

/** 把 PowerPoint 交给 MinerU。zip 包是 pptx，其余按旧版 ppt。 */
export function parsePpt(buffer: Buffer) {
  const extension = buffer.subarray(0, 2).toString('utf8') === 'PK' ? 'pptx' : 'ppt';
  return parseWithMineru(buffer, extension);
}
