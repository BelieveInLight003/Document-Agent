import { createOpenAI } from '@ai-sdk/openai';
import { ServiceUnavailableException } from '@nestjs/common';
import type { LanguageModel } from 'ai';

/**
 * 对话模型。检索回答、指代改写和历史摘要共用同一套环境变量。
 * 没配 OPENAI_API_KEY 时直接失败，调用方决定是拒答还是退回原文。
 */
export function createChatModel(): LanguageModel {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ServiceUnavailableException('对话模型未配置');
  }
  const baseURL =
    process.env.OPENAI_BASE_URL ??
    process.env.EMBEDDING_BASE_URL ??
    'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const name = process.env.CHAT_MODEL ?? 'qwen-plus';
  return createOpenAI({ apiKey, baseURL }).chat(name);
}
