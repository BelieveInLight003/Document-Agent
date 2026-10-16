import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type SnowflakeGenerator = {
  generate(): string;
};

type SnowflakeConstructor = new (options?: {
  mid?: number;
  offset?: number;
}) => SnowflakeGenerator;

const imported = require('snowflake-id') as
  | SnowflakeConstructor
  | {
      default?: SnowflakeConstructor | { default?: SnowflakeConstructor };
    };

function resolveSnowflake(): SnowflakeConstructor {
  if (typeof imported === 'function') {
    return imported;
  }

  const nested = imported.default;
  if (typeof nested === 'function') {
    return nested;
  }
  if (nested && typeof nested.default === 'function') {
    return nested.default;
  }

  throw new Error('无法加载 snowflake-id');
}

const SnowflakeId = resolveSnowflake();

/** 2024-01-01 UTC，保证生成值落在 PostgreSQL BIGINT 范围内 */
export const snowflake = new SnowflakeId({
  mid: 1,
  offset: 1_704_067_200_000,
});
