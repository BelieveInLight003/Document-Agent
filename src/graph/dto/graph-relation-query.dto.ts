import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const GRAPH_RELATION_TYPES = ['HAS_CHUNK', 'MENTIONS', 'RELATED'] as const;

/** 按关键词检索图谱关系。relation 可限定结构关系类型。 */
export class GraphRelationQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  keyword: string;

  @IsOptional()
  @IsIn(GRAPH_RELATION_TYPES)
  relation?: (typeof GRAPH_RELATION_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;
}
