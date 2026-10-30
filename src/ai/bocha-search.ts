import type { HybridHitView } from './ai.view.js';

const BOCHA_URL = 'https://api.bochaai.com/v1/web-search';
const QUERY_LIMIT = 200;
const SNIPPET_LIMIT = 800;
const PAGE_LIMIT = 8;

/**
 * 博查 Web Search。WEB_SEARCH_ENABLED 为 true 且密钥存在时才联网。
 * 密钥只放在请求头里，失败信息里不带响应正文，避免把密钥写进日志。
 */
export function bochaEnabled() {
  return readWebSearchEnabled() && Boolean(process.env.BOCHA_API_KEY?.trim());
}

export function bochaDisabledReason() {
  if (!readWebSearchEnabled()) return '联网检索已关闭。';
  return '还没有配置博查搜索密钥，不能联网。';
}

/** 每次调用再读 .env。true 转成布尔值后再判断。 */
function readWebSearchEnabled() {
  return process.env.WEB_SEARCH_ENABLED?.trim() === 'true';
}

/** 把博查返回的网页收成可以评估和引用的资料。没有链接或正文的条目丢掉。 */
export function bochaPassages(
  payload: unknown,
  limit: number,
): HybridHitView[] {
  const pages = readPages(payload);
  const passages: HybridHitView[] = [];
  for (const page of pages) {
    if (passages.length >= limit) break;
    const url = httpUrl(page.url);
    const body = text(page.summary) || text(page.snippet);
    if (!url || !body) continue;
    const title = text(page.name) || url;
    const site = text(page.siteName);
    const published = text(page.datePublished).slice(0, 10);
    const note = [site, published].filter((part) => part.length > 0).join(' ');
    passages.push({
      chunkId: text(page.id) || url,
      documentId: '',
      contentId: '',
      title,
      chapter: site || null,
      content: clip(note ? `${body}\n${note}` : body, SNIPPET_LIMIT),
      score: 1,
      channels: ['web'],
      url,
    });
  }
  return passages;
}

export async function searchBocha(
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<HybridHitView[]> {
  const key = process.env.BOCHA_API_KEY?.trim();
  if (!key) throw new Error('博查搜索未配置');
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch(BOCHA_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: clip(query, QUERY_LIMIT),
      freshness: 'noLimit',
      summary: true,
      count: Math.min(PAGE_LIMIT, Math.max(1, limit)),
    }),
    signal: AbortSignal.any([signal, timeout]),
  });
  if (!response.ok) throw new Error('博查搜索失败');
  return bochaPassages(
    await response.json(),
    Math.min(PAGE_LIMIT, Math.max(1, limit)),
  );
}

function readPages(payload: unknown) {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  if (root.code !== undefined && Number(root.code) !== 200) {
    throw new Error('博查搜索没有返回结果');
  }
  const data =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root;
  const pages = data.webPages;
  if (!pages || typeof pages !== 'object') return [];
  const value = (pages as Record<string, unknown>).value;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object',
  );
}

function httpUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(value: string, max: number) {
  const chars = [...value.trim()];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('');
}
