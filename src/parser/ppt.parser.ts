import { decodeXml, extractBinaryText, readZip } from './zip.js';

/** 把 PowerPoint（.ppt / .pptx）按幻灯片解析成 Markdown。 */
export function parsePpt(buffer: Buffer) {
  if (buffer.subarray(0, 2).toString('utf8') !== 'PK') {
    return extractBinaryText(buffer);
  }

  const files = readZip(buffer);
  const slides = [...files.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => slideNumber(left) - slideNumber(right));

  return slides
    .map((name, index) => {
      const texts = [
        ...(files.get(name) ?? '').matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g),
      ]
        .map((match) => decodeXml(match[1]).trim())
        .filter(Boolean);
      if (texts.length === 0) {
        return '';
      }
      return [`## 幻灯片 ${index + 1}`, ...texts.map((text) => `- ${text}`)].join(
        '\n\n',
      );
    })
    .filter(Boolean)
    .join('\n\n');
}

function slideNumber(name: string) {
  return Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}
