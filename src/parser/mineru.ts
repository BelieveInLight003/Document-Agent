import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readZipBytes } from './zip.js';

/**
 * 用本机 MinerU 把版式文档转成 Markdown，并带上文档里的图片。
 *
 * 默认调用 mineru-kit，用 zip 一次拿出全文和图片。
 * mineru 是文档库客户端，stdout 会截断，--wait 超时也不取消任务，所以不作为默认。
 * PDF 用 standard，覆盖扫描件和版面；Word、PPT 只用 MinerU 的 flash 本地解析。
 * 图片字节交给调用方上传，Markdown 里先保留原来的相对路径。
 */

export type MineruExtension = 'pdf' | 'doc' | 'docx' | 'ppt' | 'pptx';

export type ParsedImage = {
  /** Markdown 或 HTML 里写的原地址，用来替换成对象存储链接。 */
  ref: string;
  filename: string;
  data: Buffer;
  contentType: string;
};

export type ParsedMineru = {
  markdown: string;
  images: ParsedImage[];
};

const PDF_TIERS = new Set(['flash', 'basic', 'standard', 'advanced']);
const DEFAULT_TIMEOUT_MS = 600_000;
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  jp2: 'image/jp2',
};

export async function parseWithMineru(buffer: Buffer, extension: MineruExtension): Promise<ParsedMineru> {
  const command = process.env.MINERU_BIN?.trim() || 'mineru-kit';
  const timeout = timeoutMs();
  const directory = await mkdtemp(path.join(tmpdir(), 'mineru-'));
  const libraryCommand = path.basename(command) === 'mineru';
  const input = path.join(directory, `source.${extension}`);
  const output = path.join(directory, libraryCommand ? 'output.md' : 'result.zip');
  try {
    await writeFile(input, buffer);
    await runMineru(
      command,
      mineruArguments({
        command,
        extension,
        input,
        output,
        timeoutMs: timeout,
        pdfTier: extension === 'pdf' ? pdfTier() : 'flash',
      }),
      timeout,
    );
    const files = await loadBundle(directory, output);
    const markdown = pickMarkdown(files);
    return { markdown, images: collectDocumentImages(markdown, files) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function mineruArguments(options: {
  command: string;
  extension: MineruExtension;
  input: string;
  output: string;
  timeoutMs: number;
  pdfTier: string;
}) {
  const args = ['parse', options.input, '-o', options.output];
  const name = options.command.split(/[/\\]/).pop();
  if (name === 'mineru') {
    args.push('--wait', String(Math.max(1, Math.ceil(options.timeoutMs / 1000))));
    if (options.extension === 'pdf') {
      args.push('--pages', 'all');
    }
    return args;
  }
  args.push('--format', 'zip');
  args.push('--tier', options.extension === 'pdf' ? options.pdfTier : 'flash');
  return args;
}

/** 从 Markdown 里找出本地图片和 data URL。已经是 http 链接的不动。 */
export function collectDocumentImages(markdown: string, files: Map<string, Buffer>) {
  const images: ParsedImage[] = [];
  const seen = new Set<string>();
  for (const ref of imageRefs(markdown)) {
    if (seen.has(ref) || isRemote(ref)) {
      continue;
    }
    seen.add(ref);
    if (ref.startsWith('data:')) {
      const decoded = decodeDataImage(ref);
      if (!decoded) {
        throw new Error('MinerU 图片数据无法读取');
      }
      images.push({ ref, ...decoded });
      continue;
    }
    const file = findImage(files, ref);
    images.push({
      ref,
      filename: path.posix.basename(file.name),
      data: file.data,
      contentType: contentTypeOf(file.name),
    });
  }
  return images;
}

/** 只替换图片地址。普通链接和图注文字保持原样。 */
export function replaceImageRefs(markdown: string, urls: Map<string, string>) {
  const withMarkdown = markdown.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (full, alt: string, raw: string) => {
    const target = imageTarget(raw);
    const url = urls.get(target);
    if (!url) {
      return full;
    }
    return `![${alt}](${raw.replace(target, url)})`;
  });
  return withMarkdown.replace(/<img\b([^>]*?)\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')([^>]*)>/gi, (full, before: string, doubleQuoted: string | undefined, singleQuoted: string | undefined, after: string) => {
    const target = imageTarget(doubleQuoted ?? singleQuoted ?? '');
    const url = urls.get(target);
    if (!url) {
      return full;
    }
    const quote = doubleQuoted != null ? '"' : "'";
    return `<img${before}src=${quote}${url}${quote}${after}>`;
  });
}

function imageRefs(markdown: string) {
  const refs: string[] = [];
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\n]+)\)/g)) {
    refs.push(imageTarget(match[1]));
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    refs.push(imageTarget(match[1] ?? match[2] ?? ''));
  }
  return refs.filter(Boolean);
}

function imageTarget(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<') && trimmed.includes('>')) {
    return trimmed.slice(1, trimmed.indexOf('>')).trim();
  }
  const titled = /^(\S+)\s+["']/.exec(trimmed);
  return titled?.[1] ?? trimmed.split(/\s+/)[0] ?? '';
}

function isRemote(ref: string) {
  return /^https?:\/\//i.test(ref) || ref.startsWith('//');
}

function decodeDataImage(ref: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(ref);
  if (!match) {
    return undefined;
  }
  const contentType = match[1].toLowerCase();
  const data = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (data.length === 0) {
    return undefined;
  }
  const subtype = contentType.slice('image/'.length).split('+')[0].replace('jpeg', 'jpg');
  return { filename: `image.${subtype || 'img'}`, data, contentType };
}

function findImage(files: Map<string, Buffer>, ref: string) {
  const wanted = normalizePath(ref);
  let suffix: { name: string; data: Buffer } | undefined;
  for (const [name, data] of files) {
    const key = normalizePath(name);
    if (!contentTypeOf(key)) {
      continue;
    }
    if (key === wanted) {
      return { name: key, data };
    }
    if (key.endsWith(`/${wanted}`)) {
      if (suffix && suffix.name !== key) {
        throw new Error(`MinerU 图片路径不唯一：${ref}`);
      }
      suffix = { name: key, data };
    }
  }
  if (!suffix) {
    throw new Error(`MinerU 没有导出图片：${ref}`);
  }
  return suffix;
}

function normalizePath(value: string) {
  let text = value.trim().replace(/\\/g, '/');
  try {
    text = decodeURIComponent(text);
  } catch {
    // 非法转义时按原文匹配。
  }
  return text.replace(/^\/+/, '').replace(/^(?:\.\/)+/, '');
}

function contentTypeOf(filename: string) {
  const extension = path.posix.extname(filename).slice(1).toLowerCase();
  return IMAGE_TYPES[extension] ?? '';
}

async function loadBundle(directory: string, output: string) {
  if (output.endsWith('.zip')) {
    const zipped = await readFile(output).catch(() => undefined);
    if (zipped) {
      return readZipBytes(zipped);
    }
  }
  const files = new Map<string, Buffer>();
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(directory, absolute).split(path.sep).join('/');
    if (relative.endsWith('.zip') || relative.startsWith('source.')) {
      continue;
    }
    files.set(relative, await readFile(absolute));
  }
  return files;
}

function pickMarkdown(files: Map<string, Buffer>) {
  const names = [...files.keys()].filter((name) => name.toLowerCase().endsWith('.md'));
  const preferred =
    names.find((name) => name === 'markdown.md' || name.endsWith('/markdown.md')) ??
    names.find((name) => name === 'output.md' || name.endsWith('/output.md')) ??
    names[0];
  if (!preferred) {
    throw new Error('MinerU 没有写出 Markdown');
  }
  return files.get(preferred)?.toString('utf8') ?? '';
}

function pdfTier() {
  const tier = process.env.MINERU_PDF_TIER?.trim() || 'standard';
  if (!PDF_TIERS.has(tier)) {
    throw new Error('MINERU_PDF_TIER 只能是 flash、basic、standard、advanced');
  }
  return tier;
}

function timeoutMs() {
  const raw = process.env.MINERU_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('MINERU_TIMEOUT_MS 要是正整数，单位毫秒');
  }
  return value;
}

function runMineru(command: string, args: string[], timeout: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let settled = false;
    let stderr = '';
    const timer = setTimeout(() => {
      stop(child.pid);
      finish(new Error(`MinerU 解析超时（${Math.round(timeout / 1000)} 秒）`));
    }, timeout);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish(new Error(`找不到 MinerU 命令 ${command}。请先安装，或设置 MINERU_BIN。`));
        return;
      }
      finish(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        finish();
        return;
      }
      const detail = stderr.trim();
      finish(new Error(detail ? `MinerU 解析失败：${detail}` : `MinerU 解析失败，退出码 ${code ?? '未知'}`));
    });

    function finish(error?: Error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }
  });
}

function stop(pid: number | undefined) {
  if (pid == null) {
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 进程已经退出。
    }
  }
}
