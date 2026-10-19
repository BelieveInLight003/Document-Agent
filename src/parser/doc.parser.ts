import { decodeXml, extractBinaryText, readZip } from './zip.js';

/** 把 Word（.doc / .docx）解析成 Markdown。 */
export function parseDoc(buffer: Buffer) {
  if (buffer.subarray(0, 2).toString('utf8') === 'PK') {
    return parseDocx(buffer);
  }
  return extractBinaryText(buffer);
}

function parseDocx(buffer: Buffer) {
  const xml = readZip(buffer).get('word/document.xml') ?? '';
  const paragraphs = xml.split(/<\/w:p>/).map((paragraph) => {
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(paragraph)?.[1] ?? '';
    const text = [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((match) => decodeXml(match[1]))
      .join('')
      .trim();
    if (!text) {
      return '';
    }
    const heading = /^Heading(\d)$/i.exec(style);
    if (heading) {
      const level = Math.min(Number(heading[1]), 6);
      return `${'#'.repeat(level)} ${text}`;
    }
    return text;
  });

  return paragraphs.filter(Boolean).join('\n\n');
}
