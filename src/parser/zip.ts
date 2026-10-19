import { inflateRawSync } from 'node:zlib';

/** 读取 Office Open XML（docx / xlsx / pptx）这类 zip 包里的文件。 */
export function readZip(buffer: Buffer) {
  const eocd = findEocd(buffer);
  if (eocd < 0) {
    throw new Error('不是有效的 Office 压缩文件');
  }

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, string>();

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      break;
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');

    if (!name.endsWith('/') && localOffset + 30 <= buffer.length) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      const data =
        method === 0
          ? compressed
          : method === 8
            ? inflateRawSync(compressed)
            : Buffer.alloc(0);
      files.set(name, data.toString('utf8'));
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

export function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, num: string) =>
      String.fromCodePoint(Number.parseInt(num, 10)),
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 从旧版二进制 Office 文件里抽出可读文本。 */
export function extractBinaryText(buffer: Buffer) {
  const pieces = new Set<string>();
  let current = '';

  for (let index = 0; index + 1 < buffer.length; index += 2) {
    const code = buffer.readUInt16LE(index);
    if (isPrintable(code)) {
      current += String.fromCharCode(code);
      continue;
    }
    pushText(pieces, current);
    current = '';
  }
  pushText(pieces, current);

  return [...pieces].slice(0, 200).join('\n\n');
}

function findEocd(buffer: Buffer) {
  const min = Math.max(0, buffer.length - 22 - 65535);
  for (let index = buffer.length - 22; index >= min; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      return index;
    }
  }
  return -1;
}

function isPrintable(code: number) {
  return (
    (code >= 32 && code <= 126) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3000 && code <= 0x303f)
  );
}

function pushText(pieces: Set<string>, value: string) {
  const text = value.trim();
  if (text.length < 4) {
    return;
  }
  const letters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (letters / text.length >= 0.6) {
    pieces.add(text);
  }
}
