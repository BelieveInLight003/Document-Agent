import { decodeXml } from './zip.js';

/** 把 XML 元素里的文本转成 Markdown 列表。 */
export function parseXml(buffer: Buffer) {
  const xml = buffer
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const lines: string[] = [];

  for (const match of xml.matchAll(
    /<([A-Za-z_][\w:.-]*)\b[^>]*>([^<]*)<\/\1>/g,
  )) {
    const text = decodeXml(match[2]).replace(/\s+/g, ' ').trim();
    if (text) {
      lines.push(`- **${match[1]}**: ${text}`);
    }
  }

  return lines.join('\n');
}
