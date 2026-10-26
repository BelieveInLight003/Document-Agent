import { extractText, getDocumentProxy } from 'unpdf';

/** 抽出 PDF 里的文字，按页拼成 Markdown。扫描件没有文字层时结果为空。 */
export async function parsePdf(buffer: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text])
    .map((page) => page.trim())
    .filter(Boolean);
  return pages.join('\n\n');
}
