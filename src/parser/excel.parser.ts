import { decodeXml, extractBinaryText, readZip } from './zip.js';

/** 把 Excel（.xls / .xlsx）每个工作表转成 Markdown 表格。 */
export function parseExcel(buffer: Buffer) {
  if (buffer.subarray(0, 2).toString('utf8') !== 'PK') {
    return extractBinaryText(buffer);
  }

  const files = readZip(buffer);
  const shared = sharedStrings(files.get('xl/sharedStrings.xml') ?? '');
  const sheets = [...files.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => sheetNumber(left) - sheetNumber(right));

  return sheets
    .map((name, index) => {
      const table = sheetToTable(files.get(name) ?? '', shared);
      if (!table) {
        return '';
      }
      return [`## 工作表 ${index + 1}`, table].join('\n\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

function sharedStrings(xml: string) {
  return xml.split(/<si\b/).slice(1).map((item) =>
    [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((match) => decodeXml(match[1]))
      .join(''),
  );
}

function sheetToTable(xml: string, shared: string[]) {
  const rows = xml
    .split(/<row\b/)
    .slice(1)
    .map((row) => readRow(row, shared))
    .filter((row) => row.some((cell) => cell !== ''));
  if (rows.length === 0) {
    return '';
  }

  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const next = [...row];
    while (next.length < width) {
      next.push('');
    }
    return next.map(escapeCell);
  });
  const header = normalized[0];
  const divider = header.map(() => '---');
  const lines = [header, divider, ...normalized.slice(1)].map(
    (row) => `| ${row.join(' | ')} |`,
  );
  return lines.join('\n');
}

function readRow(rowXml: string, shared: string[]) {
  const cells = new Map<number, string>();
  for (const match of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const ref = /\br="([A-Z]+)\d+"/.exec(match[1])?.[1];
    if (!ref) {
      continue;
    }
    const type = /\bt="([^"]+)"/.exec(match[1])?.[1] ?? '';
    const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(match[2])?.[1] ?? '';
    const inline = [...match[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((item) => decodeXml(item[1]))
      .join('');
    let value = inline || decodeXml(raw);
    if (type === 's') {
      value = shared[Number(raw)] ?? '';
    }
    cells.set(columnIndex(ref), value.trim());
  }

  if (cells.size === 0) {
    return [];
  }
  const last = Math.max(...cells.keys());
  return Array.from({ length: last + 1 }, (_, index) => cells.get(index) ?? '');
}

function columnIndex(letters: string) {
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function sheetNumber(name: string) {
  return Number(/sheet(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

function escapeCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
