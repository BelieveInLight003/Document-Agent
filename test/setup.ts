import { Logger } from '@nestjs/common';

Logger.overrideLogger(false);
// Unit tests must not pick up live credentials from the local .env file.
for (const key of [
  'OPENAI_API_KEY',
  'MEM0_API_KEY',
  'LANGSMITH_API_KEY',
  'LANGCHAIN_API_KEY',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
]) {
  process.env[key] = '';
}
