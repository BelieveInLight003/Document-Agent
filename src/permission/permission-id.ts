import { BadRequestException, NotFoundException } from '@nestjs/common';

/** 雪花 id 以十进制字符串进出接口，入库前再转成 bigint。 */
export function parseSnowflakeId(id: string, label: string) {
  if (!/^\d+$/.test(id)) {
    throw new NotFoundException(`${label}不存在`);
  }
  return BigInt(id);
}

export function uniqueSnowflakeIds(ids: string[], label: string) {
  const unique = [...new Set(ids)];
  if (unique.some((id) => !/^\d+$/.test(id))) {
    throw new BadRequestException(`${label}不正确`);
  }
  return unique.map((id) => BigInt(id));
}
