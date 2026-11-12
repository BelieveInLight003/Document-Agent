import { parseWithMineru } from './mineru.js';

/** 把 PDF 交给 MinerU。扫描件、表格和多栏都由它处理。 */
export function parsePdf(buffer: Buffer) {
  return parseWithMineru(buffer, 'pdf');
}
