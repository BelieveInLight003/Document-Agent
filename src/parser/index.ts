import path from 'node:path';
import { parseDoc } from './doc.parser.js';
import { parseExcel } from './excel.parser.js';
import { parsePdf } from './pdf.parser.js';
import { parsePpt } from './ppt.parser.js';
import { parseTxt } from './txt.parser.js';
import { parseXml } from './xml.parser.js';

export type ParserKind = 'doc' | 'xml' | 'ppt' | 'txt' | 'excel' | 'pdf';

const EXTENSIONS: Record<string, ParserKind> = {
  '.doc': 'doc',
  '.docx': 'doc',
  '.xml': 'xml',
  '.ppt': 'ppt',
  '.pptx': 'ppt',
  '.txt': 'txt',
  '.xls': 'excel',
  '.xlsx': 'excel',
  '.pdf': 'pdf',
};

/** 用扩展名判断是否属于 doc / xml / ppt / txt / excel / pdf。 */
export function detectParser(filename: string): ParserKind | null {
  return EXTENSIONS[path.extname(filename).toLowerCase()] ?? null;
}

/** 按分类调用对应解析器，返回 Markdown。 */
export async function parseToMarkdown(kind: ParserKind, buffer: Buffer) {
  switch (kind) {
    case 'doc':
      return parseDoc(buffer);
    case 'xml':
      return parseXml(buffer);
    case 'ppt':
      return parsePpt(buffer);
    case 'txt':
      return parseTxt(buffer);
    case 'excel':
      return parseExcel(buffer);
    case 'pdf':
      return parsePdf(buffer);
  }
}
