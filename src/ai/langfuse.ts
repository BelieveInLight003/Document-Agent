import { context, trace, type Context, type Span } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { propagateAttributes, startObservation } from '@langfuse/tracing';
import { registerTelemetry } from 'ai';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';

/**
 * Langfuse 追踪。和 LangSmith 记同一条问答链路。
 * 一次提问是根记录，检索、改写、评估和模型调用挂在下面。
 * 没配公钥或私钥时不启动，问答不受影响。
 */

type FuseNode = {
  otelSpan: Span;
  update(attributes: {
    input?: unknown;
    output?: unknown;
    level?: 'ERROR';
    statusMessage?: string;
  }): unknown;
  end(): void;
};

export type LangfuseTrace = {
  ctx: Context;
  finish(outputs: Record<string, unknown>, error?: unknown): Promise<void>;
};

let processor: LangfuseSpanProcessor | undefined;
let enabled = false;

export function enableLangfuse() {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim() ?? '';
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim() ?? '';
  const baseUrl = process.env.LANGFUSE_BASE_URL?.trim() || 'https://cloud.langfuse.com';
  if (!publicKey || !secretKey) {
    console.log('[Langfuse] 未配置公钥或私钥，查找链路不会上报');
    return false;
  }
  process.env.LANGFUSE_PUBLIC_KEY = publicKey;
  process.env.LANGFUSE_SECRET_KEY = secretKey;
  process.env.LANGFUSE_BASE_URL = baseUrl;
  processor = new LangfuseSpanProcessor({ publicKey, secretKey, baseUrl, timeout: 20 });
  const sdk = new NodeSDK({ spanProcessors: [processor] });
  sdk.start();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
  enabled = true;
  console.log('[Langfuse] 追踪已开启');
  return true;
}

export function langfuseEnabled() {
  return enabled;
}

/** 当前调用是否已经在某条 Langfuse 记录里。用来避免同一次检索再开一条根记录。 */
export function insideLangfuseTrace() {
  return enabled && Boolean(trace.getActiveSpan());
}

export function openLangfuseTrace(
  name: string,
  inputs: Record<string, unknown>,
  metadata: Record<string, unknown>,
): LangfuseTrace | undefined {
  if (!enabled) return undefined;
  const userId = textId(metadata.userId);
  const sessionId = textId(metadata.sessionId);
  let root: FuseNode | undefined;
  let ctx: Context | undefined;
  try {
    propagateAttributes(
      {
        traceName: name,
        ...(userId ? { userId } : {}),
        ...(sessionId ? { sessionId } : {}),
      },
      () => {
        root = startObservation(name, { input: inputs }, { asType: 'agent' });
        ctx = trace.setSpan(context.active(), root.otelSpan);
      },
    );
  } catch (error) {
    report(error);
    return undefined;
  }
  if (!root || !ctx) return undefined;
  const opened = root;
  const parent = ctx;
  return {
    ctx: parent,
    async finish(outputs, error) {
      try {
        opened.update({
          output: outputs,
          ...(error === undefined ? {} : { level: 'ERROR' as const, statusMessage: errorText(error) }),
        });
        opened.end();
        await processor?.forceFlush();
      } catch (flushError) {
        report(flushError);
      }
    },
  };
}

export async function runLangfuseSpan<T>(
  parent: Context,
  name: string,
  runType: 'chain' | 'retriever' | 'llm',
  inputs: Record<string, unknown>,
  fn: () => Promise<T>,
  outputs: (value: T) => Record<string, unknown>,
): Promise<T> {
  return context.with(parent, async () => {
    const child = startChild(name, runType, inputs);
    const childContext = trace.setSpan(context.active(), child.otelSpan);
    try {
      const value = await context.with(childContext, fn);
      child.update({ output: outputs(value) });
      child.end();
      return value;
    } catch (error) {
      try {
        child.update({ level: 'ERROR', statusMessage: errorText(error) });
        child.end();
      } catch (endError) {
        report(endError);
      }
      throw error;
    }
  });
}

function startChild(name: string, runType: 'chain' | 'retriever' | 'llm', input: Record<string, unknown>): FuseNode {
  if (runType === 'retriever') return startObservation(name, { input }, { asType: 'retriever' });
  if (runType === 'llm') return startObservation(name, { input }, { asType: 'generation' });
  return startObservation(name, { input }, { asType: 'chain' });
}

function textId(value: unknown) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length > 0 && text.length <= 200 ? text : '';
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function report(error: unknown) {
  console.error(`[Langfuse] 上报失败：${errorText(error)}`);
}
