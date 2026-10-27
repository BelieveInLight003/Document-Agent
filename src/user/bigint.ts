import type { ValueTransformer } from 'typeorm';

/** 雪花 id 在库里是字符串，进到代码里用 bigint，避免 Number 丢精度。 */
export const bigintTransformer: ValueTransformer = {
  to: (value?: bigint | null) => (value == null ? value : value.toString()),
  from: (value?: string | null) => (value == null ? value : BigInt(value)),
};
