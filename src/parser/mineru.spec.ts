import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { collectDocumentImages, mineruArguments, replaceImageRefs } from './mineru.js';
import { readZipBytes } from './zip.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('MinerU 参数', () => {
  it('PDF 用 standard，并让 mineru-kit 导出包含图片的 zip', () => {
    expect(
      mineruArguments({
        command: 'mineru-kit',
        extension: 'pdf',
        input: 'source.pdf',
        output: 'result.zip',
        timeoutMs: 600_000,
        pdfTier: 'standard',
      }),
    ).toEqual(['parse', 'source.pdf', '-o', 'result.zip', '--format', 'zip', '--tier', 'standard']);
  });

  it('Word 和 PPT 只用 flash', () => {
    expect(
      mineruArguments({
        command: '/usr/local/bin/mineru-kit',
        extension: 'docx',
        input: 'source.docx',
        output: 'result.zip',
        timeoutMs: 600_000,
        pdfTier: 'standard',
      }),
    ).toEqual(['parse', 'source.docx', '-o', 'result.zip', '--format', 'zip', '--tier', 'flash']);
  });

  it('文档库命令 mineru 对 PDF 要解析全部页', () => {
    expect(
      mineruArguments({
        command: 'mineru',
        extension: 'pdf',
        input: 'source.pdf',
        output: 'output.md',
        timeoutMs: 90_000,
        pdfTier: 'standard',
      }),
    ).toEqual(['parse', 'source.pdf', '-o', 'output.md', '--wait', '90', '--pages', 'all']);
  });
});

describe('文档图片', () => {
  it('从 zip 里按 Markdown 的相对路径取出图片，并换成对象存储链接', () => {
    const files = readZipBytes(
      storedZip([
        ['markdown.md', Buffer.from('正文\n\n![审批流程](images/a.jpg)\n\n见 [制度](https://example.com)\n')],
        ['bundle/images/a.jpg', png],
      ]),
    );
    const markdown = files.get('markdown.md')?.toString('utf8') ?? '';
    const images = collectDocumentImages(markdown, files);
    expect(images).toHaveLength(1);
    expect(images[0]?.ref).toBe('images/a.jpg');
    expect(images[0]?.data.equals(png)).toBe(true);

    const replaced = replaceImageRefs(markdown, new Map([['images/a.jpg', 'http://localhost:9000/knowledge-hub/images/a.jpg']]));
    expect(replaced).toContain('![审批流程](http://localhost:9000/knowledge-hub/images/a.jpg)');
    expect(replaced).toContain('[制度](https://example.com)');
  });

  it('HTML 图片换成链接，已经是 http 的地址不动', () => {
    const markdown = '<img src="images/a.png" alt="封面"> <img src="https://example.com/b.png">';
    const images = collectDocumentImages(markdown, new Map([['images/a.png', png]]));
    expect(images.map((item) => item.ref)).toEqual(['images/a.png']);
    const replaced = replaceImageRefs(
      markdown,
      new Map([['images/a.png', 'http://localhost:9000/knowledge-hub/images/a.png']]),
    );
    expect(replaced).toBe(
      '<img src="http://localhost:9000/knowledge-hub/images/a.png" alt="封面"> <img src="https://example.com/b.png">',
    );
  });

  it('Markdown 引用了图片但压缩包里没有时失败', () => {
    expect(() => collectDocumentImages('![](images/missing.png)', new Map())).toThrow('MinerU 没有导出图片：images/missing.png');
  });
});

function storedZip(entries: Array<[string, Buffer]>, method: 0 | 8 = 8) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name);
    const stored = method === 8 ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localBytes = Buffer.concat([local, nameBuf, stored]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    locals.push(localBytes);
    offset += localBytes.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}
