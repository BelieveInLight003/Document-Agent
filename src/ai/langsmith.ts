import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateText, streamText, wrapLanguageModel } from 'ai';
import { RunTree } from 'langsmith/run_trees';
import { getCurrentRunTree, withRunTree } from 'langsmith/traceable';
import { wrapAISDK } from 'langsmith/experimental/vercel';
import type { HybridHitView } from './ai.view.js';

/**
 * 查找链路的 LangSmith 追踪。
 *
 * 一条用户提问对应一条 chain。下面挂整理问题、文档检索、长期记忆检索、生成回答。
 * 模型调用会再挂在当前步骤下面，提示词和输出可以在 LangSmith 里展开。
 * 没有 LANGSMITH_API_KEY 时全部退回普通函数，问答不受影响。
 */

loadEnvFile();
const tracing = enableLangSmith();

const traced = wrapAISDK(
  { generateText, streamText, wrapLanguageModel },
  { name: '对话模型', tracingEnabled: tracing },
);

/** 改写、摘要、记忆分类走这里，才能挂到当前问题的 trace 上。 */
export const tracedGenerateText = traced.generateText;
/** 流式回答走这里。消费 textStream 时，这次调用仍挂在「生成回答」下面。 */
export const tracedStreamText = traced.streamText;

export type TraceRunType = 'chain' | 'retriever' | 'llm';

export type ChatTrace = {
  span<T>(
    name: string,
    runType: TraceRunType,
    inputs: Record<string, unknown>,
    fn: () => Promise<T>,
    outputs: (value: T) => Record<string, unknown>,
  ): Promise<T>;
  end(outputs: Record<string, unknown>, error?: unknown): Promise<void>;
};

/** 文档检索写进 trace 的摘要。只留标题、分数和一小段原文，避免整篇文档刷进 LangSmith。 */
export function hitTrace(items: HybridHitView[]) {
  return {
    count: items.length,
    hits: items.map((item) => ({
      documentId: item.documentId,
      title: item.title,
      chapter: item.chapter,
      score: item.score,
      channels: item.channels,
      excerpt: [...item.content].slice(0, 180).join(''),
    })),
  };
}

/**
 * 打开一条问题的根 trace。密钥没配时返回空实现。
 * metadata 用来在 LangSmith 里按会话过滤。
 */
export function startChatTrace(
  name: string,
  inputs: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): ChatTrace {
  if (!tracing) {
    return {
      span: (_name, _runType, _inputs, fn) => fn(),
      end: async () => undefined,
    };
  }
  const root = new RunTree({
    name,
    run_type: 'chain',
    inputs,
    metadata,
    project_name: process.env.LANGSMITH_PROJECT,
    tracingEnabled: true,
  });
  const opened = root.postRun().catch(report);
  let ended = false;
  return {
    async span(step, runType, stepInputs, fn, outputs) {
      let child: RunTree;
      try {
        await opened;
        child = root.createChild({
          name: step,
          run_type: runType,
          inputs: stepInputs,
          tracingEnabled: true,
        });
        await child.postRun();
      } catch (error) {
        report(error);
        return fn();
      }
      try {
        const value = await withRunTree(child, fn);
        await child.end(outputs(value));
        await child.patchRun();
        return value;
      } catch (error) {
        await child
          .end(undefined, error instanceof Error ? error.message : String(error))
          .catch(report);
        await child.patchRun().catch(report);
        throw error;
      }
    },
    async end(outputs, error) {
      if (ended) return;
      ended = true;
      try {
        await opened;
        await root.end(
          outputs,
          error === undefined ? undefined : error instanceof Error ? error.message : String(error),
        );
        await root.patchRun();
      } catch (reportError) {
        report(reportError);
      }
    },
  };
}

/** 已经在某条 trace 里时，不要再开一条根记录，否则同一次检索会在 LangSmith 里出现两遍。 */
export function insideTrace() {
  if (!tracing) return false;
  return Boolean(getCurrentRunTree(true));
}

/**
 * 读 .env，并把 LangSmith 的开关同步给 LangChain。
 * 只在进程里还没有这个变量时写入，不覆盖启动命令已经传入的值。
 * 没有密钥时强制关掉追踪，避免空密钥把每次问答都报成失败。
 */
function enableLangSmith() {
  const apiKey = envValue('LANGSMITH_API_KEY') || envValue('LANGCHAIN_API_KEY');
  const project = envValue('LANGSMITH_PROJECT') || envValue('LANGCHAIN_PROJECT') || 'knowledge-hub';
  const endpoint =
    envValue('LANGSMITH_ENDPOINT') ||
    envValue('LANGCHAIN_ENDPOINT') ||
    'https://api.smith.langchain.com';
  if (!apiKey) {
    process.env.LANGSMITH_TRACING = 'false';
    process.env.LANGCHAIN_TRACING_V2 = 'false';
    console.log('[LangSmith] 未配置 LANGSMITH_API_KEY，查找链路不会上报');
    return false;
  }
  assign('LANGSMITH_API_KEY', apiKey);
  assign('LANGCHAIN_API_KEY', apiKey);
  assign('LANGSMITH_PROJECT', project);
  assign('LANGCHAIN_PROJECT', project);
  assign('LANGSMITH_ENDPOINT', endpoint);
  assign('LANGCHAIN_ENDPOINT', endpoint);
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  console.log(`[LangSmith] 追踪已开启，项目 ${project}`);
  return true;
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value || '';
}

function assign(name: string, value: string) {
  if (!process.env[name]?.trim()) {
    process.env[name] = value;
  }
}

/** 不覆盖已经存在的环境变量。文件不存在就继续用进程环境。 */
function loadEnvFile() {
  let text = '';
  try {
    text = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function report(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[LangSmith] 上报失败：${message}`);
}
